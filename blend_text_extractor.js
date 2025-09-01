// JavaScript Blend File Text Extractor
// Based on the working Python implementation

class BlendFileTextExtractor {
    constructor() {
        this.littleEndian = true;
        this.ptrSize = 8;
    }

    analyzeBlendFile(arrayBuffer) {
        const data = new Uint8Array(arrayBuffer);
        console.log('DEBUG: Starting blend file analysis, file size:', arrayBuffer.byteLength);
        
        // Parse header
        const magic = new TextDecoder().decode(data.slice(0, 7));
        if (magic !== 'BLENDER') {
            throw new Error(`Invalid magic: ${magic}`);
        }
        
        this.ptrSize = data[7] === 45 ? 8 : 4; // 45 = '-'
        this.littleEndian = data[8] === 118; // 118 = 'v'
        const version = new TextDecoder().decode(data.slice(9, 12));
        
        console.log(`Blender version: ${version}, ${this.ptrSize * 8}-bit`);
        
        // Parse all blocks
        const blocks = this.parseAllBlocks(data);
        console.log('DEBUG: Total blocks parsed:', blocks.length);
        
        // Extract text blocks
        const textBlocks = this.extractTextBlocks(blocks);
        console.log('DEBUG: Text blocks extracted:', textBlocks.length);
        
        return {
            version,
            architecture: `${this.ptrSize * 8}-bit`,
            totalBlocks: blocks.length,
            textBlocks: textBlocks.map(block => ({
                ...block,
                analysis: this.analyzeScript(block.content)
            }))
        };
    }

    parseAllBlocks(data) {
        const blocks = [];
        let offset = 12; // Skip header
        
        while (offset < data.length - 16) {
            try {
                // Read block header
                const code = new TextDecoder().decode(data.slice(offset, offset + 4));
                const length = this.readInt32(data, offset + 4);
                const sdnaIndex = this.readInt32(data, offset + 8 + this.ptrSize);
                const count = this.readInt32(data, offset + 12 + this.ptrSize);
                
                const headerSize = 16 + this.ptrSize;
                const bodyOffset = offset + headerSize;
                
                // Validate block
                if (length < 0 || bodyOffset + length > data.length) {
                    break;
                }
                
                const codeStr = code.replace(/\0/g, '');
                const bodyData = data.slice(bodyOffset, bodyOffset + length);
                
                blocks.push({
                    code: codeStr,
                    length,
                    count,
                    sdnaIndex,
                    body: bodyData,
                    offset: bodyOffset
                });
                
                offset += headerSize + length;
                
            } catch (e) {
                console.error(`Error parsing block at offset ${offset}:`, e);
                break;
            }
        }
        
        return blocks;
    }

    extractTextBlocks(blocks) {
        const textBlocks = [];
        console.log('DEBUG: Starting text block extraction from', blocks.length, 'blocks');
        
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (block.code === 'TX' || block.code === 'TEXT') {
                console.log(`DEBUG: Found text block at index ${i}, code: ${block.code}`);
                
                // Extract text name from TX block
                let textName = this.extractTextName(block.body);
                if (textName && textName.startsWith('TX')) {
                    textName = textName.slice(2).trim();
                }
                console.log(`DEBUG: Extracted text name: "${textName}"`);
                
                // Find the actual text content in following DATA blocks
                const content = this.findTextContent(blocks, i);
                console.log(`DEBUG: Found content length: ${content ? content.length : 0}`);
                
                if (content) {
                    textBlocks.push({
                        name: textName || `Text Block ${textBlocks.length + 1}`,
                        content: content,
                        blockIndex: i
                    });
                    console.log(`DEBUG: Added text block: ${textName || `Text Block ${textBlocks.length}`}`);
                }
            }
        }
        
        console.log('DEBUG: Total text blocks extracted:', textBlocks.length);
        return textBlocks;
    }

    extractTextName(bodyData) {
        try {
            // TX blocks start with "TX" followed by name
            // Skip past "TX" prefix and look for the name at different offsets
            for (let offset of [2, 4, 8, 16]) {
                if (offset >= bodyData.length) {
                    continue;
                }

                // Find null terminator
                let end = -1;
                for (let i = offset; i < bodyData.length; i++) {
                    if (bodyData[i] === 0) {
                        end = i;
                        break;
                    }
                }

                if (end > offset) {
                    const candidate = new TextDecoder('utf-8', { fatal: false }).decode(bodyData.slice(offset, end));
                    // Clean the candidate - remove non-printable characters
                    const cleaned = candidate.replace(/[^\x20-\x7E]/g, '').trim();
                    if (cleaned && cleaned.length > 0) {
                        return cleaned;
                    }
                }
            }
        } catch (e) {
            // Ignore decode errors
        }

        // Fallback: look for any readable string
        try {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(bodyData);
            const parts = text.split('\0');
            for (let part of parts) {
                const cleaned = part.replace(/[^\x20-\x7E]/g, '').trim();
                if (cleaned.length > 2 && /^[a-zA-Z0-9\s_-]+$/.test(cleaned)) {
                    return cleaned;
                }
            }
        } catch (e) {
            // Ignore decode errors
        }
        
        return null;
    }

    findTextContent(blocks, txIndex) {
        const foundLines = [];
        
        for (let i = txIndex + 1; i < Math.min(txIndex + 100, blocks.length); i++) {
            const block = blocks[i];
            
            if (block.code === 'DATA' && block.sdnaIndex === 0) {
                const content = this.extractTextContent(block.body);
                if (content !== null) {
                    foundLines.push(content); // Don't trim - preserve whitespace
                }
            } else if (block.code === 'TX' || block.code === 'TEXT') {
                // Hit another text block, stop looking
                break;
            }
        }
        
        return foundLines.length > 0 ? foundLines.join('\n') : null;
    }

    extractTextContent(bodyData) {
        // Handle very small blocks
        if (bodyData.length <= 4) {
            try {
                const content = new TextDecoder('utf-8', { fatal: false }).decode(bodyData).replace(/\0/g, '');
                console.log('DEBUG: Small block content:', JSON.stringify(content));
                return content || "";
            } catch (e) {
                console.log('DEBUG: Error decoding small block:', e);
                return "";
            }
        }

        // Try direct UTF-8 decoding
        try {
            let text = new TextDecoder('utf-8', { fatal: false }).decode(bodyData);
            console.log('DEBUG: Raw decoded text:', JSON.stringify(text));
            text = this.cleanText(text);
            console.log('DEBUG: Cleaned text:', JSON.stringify(text));
            return text;
        } catch (e) {
            console.log('DEBUG: Error decoding text block:', e);
            return "";
        }
    }

    cleanText(text) {
        if (!text) return "";
        text = text.replace(/[\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0B\x0C\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x7F\x80\x81\x82\x83\x84\x85\x86\x87\x88\x89\x8A\x8B\x8C\x8D\x8E\x8F\x90\x91\x92\x93\x94\x95\x96\x97\x98\x99\x9A\x9B\x9C\x9D\x9E\x9F]/g, '');
        return text;
    }

    analyzeScript(content) {
        if (!content) {
            return {
                isStartup: false,
                startupReasons: [],
                riskLevel: 'safe',
                warnings: []
            };
        }

        const startupReasons = [];
        const warnings = [];
        let riskLevel = 'safe';

        // Check for startup/auto-execution indicators
        const startupPatterns = [
            [/if\s+__name__\s*==\s*["']__main__["']/gi, 'Main execution block present'],
            [/bpy\.app\.handlers\.\w+\.append/gi, 'Event handler registration'],
            [/register\(\)/gi, 'Register function call'],
            [/def\s+register\s*\(/gi, 'Register function definition'],
            [/@persistent/gi, 'Persistent decorator usage'],
            [/bpy\.utils\.register_class/gi, 'Class registration'],
            [/addon_info\s*=/gi, 'Addon metadata structure'],
            [/bl_info\s*=/gi, 'Blender addon metadata'],
            [/bpy\.ops\.\w+\.\w+\(\)/gi, 'Direct operator execution']
        ];

        for (const [pattern, reason] of startupPatterns) {
            if (pattern.test(content)) {
                startupReasons.push(reason);
            }
        }

        // Security analysis
        const securityPatterns = [
            [/\beval\s*\(/gi, 'Dynamic code execution (eval)', 'high'],
            [/\bexec\s*\(/gi, 'Dynamic code execution (exec)', 'high'],
            [/os\.system\s*\(/gi, 'System command execution', 'high'],
            [/subprocess\.\w+/gi, 'Process execution capabilities', 'medium'],
            [/import\s+subprocess/gi, 'Subprocess module imported', 'medium'],
            [/__import__\s*\(/gi, 'Dynamic module import', 'medium'],
            [/base64\.decode|base64\.b64decode/gi, 'Base64 data decoding', 'medium'],
            [/urllib\.|requests\.|http\.|fetch/gi, 'Network communication', 'medium'],
            [/open\s*\([^)]*["'][wa]["']/gi, 'File system writes', 'low'],
            [/\.decode\s*\(/gi, 'Data decoding operations', 'low'],
            [/chr\s*\(|ord\s*\(/gi, 'Character encoding operations', 'low']
        ];

        for (const [pattern, warning, level] of securityPatterns) {
            if (pattern.test(content)) {
                warnings.push(warning);
                if (level === 'high' && ['safe', 'low', 'medium'].includes(riskLevel)) {
                    riskLevel = 'high';
                } else if (level === 'medium' && ['safe', 'low'].includes(riskLevel)) {
                    riskLevel = 'medium';
                } else if (level === 'low' && riskLevel === 'safe') {
                    riskLevel = 'low';
                }
            }
        }

        // Check for obfuscation patterns
        const obfuscationPatterns = [
            [/["'].{20,}["'].*\.decode/gi, 'Encoded strings with decode'],
            [/["'][A-Za-z0-9+/]{20,}={0,2}["']/gi, 'Base64-like strings'],
            [/\\x[0-9a-fA-F]{2}/gi, 'Hex encoded strings'],
            [/join\s*\(\s*.*split/gi, 'String splitting/joining obfuscation'],
            [/chr\s*\(\s*\d+\s*\)/gi, 'Character code obfuscation']
        ];

        for (const [pattern, warning] of obfuscationPatterns) {
            if (pattern.test(content)) {
                warnings.push(`Obfuscation: ${warning}`);
                if (['safe', 'low'].includes(riskLevel)) {
                    riskLevel = 'medium';
                }
            }
        }

        return {
            isStartup: startupReasons.length > 0,
            startupReasons,
            riskLevel,
            warnings
        };
    }

    readInt32(data, offset) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        return view.getInt32(0, this.littleEndian);
    }
}

// Export for use in HTML
if (typeof window !== 'undefined') {
    window.BlendFileTextExtractor = BlendFileTextExtractor;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BlendFileTextExtractor;
}