/**
 * Tests for chat message parsers
 * 
 * These tests verify that each platform's parser correctly extracts:
 * - User messages
 * - Assistant messages  
 * - Chat titles
 * - Window titles
 * - Browser URLs
 */

import { describe, it, expect } from 'vitest';
import { 
    parseClaudeDesktopOutput, 
    parseClaudeWebOutput, 
    parseChatGPTOutput, 
    parseGeminiOutput 
} from '../parsers';

// ============== TEST CASES ==============

describe('Claude Desktop Parser', () => {
    const sampleOutput = `[WINDOW_TITLE] Claude
[CHAT_TITLE] Debugging TypeScript Issues
[USER] Can you help me debug this error?
[ASSISTANT] Of course! Please share the error message.
[USER] TypeError: Cannot read property 'foo' of undefined
[ASSISTANT] This error typically occurs when you try to access a property on a variable that is undefined.
[ASSISTANT] Here are some common causes:
[ASSISTANT] 1. The object wasn't initialized
[ASSISTANT] 2. An async operation hasn't completed`;

    it('should extract window title', () => {
        const result = parseClaudeDesktopOutput(sampleOutput);
        expect(result.windowTitle).toBe('Claude');
    });

    it('should extract chat title', () => {
        const result = parseClaudeDesktopOutput(sampleOutput);
        expect(result.chatTitle).toBe('Debugging TypeScript Issues');
    });

    it('should extract user messages', () => {
        const result = parseClaudeDesktopOutput(sampleOutput);
        const userMessages = result.messages.filter(m => m.role === 'user');
        expect(userMessages.length).toBe(2);
        expect(userMessages[0]!.content).toBe('Can you help me debug this error?');
        expect(userMessages[1]!.content).toBe("TypeError: Cannot read property 'foo' of undefined");
    });

    it('should extract assistant messages and combine consecutive ones', () => {
        const result = parseClaudeDesktopOutput(sampleOutput);
        const assistantMessages = result.messages.filter(m => m.role === 'assistant');
        expect(assistantMessages.length).toBe(2);
        expect(assistantMessages[0]!.content).toBe('Of course! Please share the error message.');
        expect(assistantMessages[1]!.content).toContain('This error typically occurs');
        expect(assistantMessages[1]!.content).toContain('1. The object wasn\'t initialized');
    });

    it('should handle empty input', () => {
        const result = parseClaudeDesktopOutput('');
        expect(result.messages.length).toBe(0);
    });
});

describe('Claude Web Parser', () => {
    const sampleOutput = `[WINDOW_TITLE] Chat - Claude - Brave
[BROWSER_URL] claude.ai/chat/abc123
[CHAT_TITLE] API Integration Help
[USER] How do I use the fetch API?
[ASSISTANT] The fetch API is a modern way to make HTTP requests.
[ASSISTANT] Here's a basic example:
[USER] Thanks! What about error handling?
[ASSISTANT] You can use try/catch or .catch() for error handling.`;

    it('should extract browser URL', () => {
        const result = parseClaudeWebOutput(sampleOutput);
        expect(result.browserUrl).toBe('claude.ai/chat/abc123');
    });

    it('should extract chat title', () => {
        const result = parseClaudeWebOutput(sampleOutput);
        expect(result.chatTitle).toBe('API Integration Help');
    });

    it('should extract all messages in order', () => {
        const result = parseClaudeWebOutput(sampleOutput);
        expect(result.messages.length).toBe(4);
        expect(result.messages[0]!.role).toBe('user');
        expect(result.messages[1]!.role).toBe('assistant');
        expect(result.messages[2]!.role).toBe('user');
        expect(result.messages[3]!.role).toBe('assistant');
    });

    it('should combine consecutive assistant messages', () => {
        const result = parseClaudeWebOutput(sampleOutput);
        const firstAssistant = result.messages[1]!;
        expect(firstAssistant.content).toContain('The fetch API');
        expect(firstAssistant.content).toContain('basic example');
    });
});

describe('ChatGPT Parser', () => {
    const sampleOutput = `[WINDOW_TITLE] ChatGPT - Brave
[BROWSER_URL] chatgpt.com/c/abc123
[CHAT_TITLE] Team Context Reminder
[USER] You said: Rameez and me work together at Wednesday Solutions
[ASSISTANT] ChatGPT said: Got it. I'll remember that.
[ASSISTANT] If you want, I can remember this and use it for context.`;

    it('should extract chat title', () => {
        const result = parseChatGPTOutput(sampleOutput);
        expect(result.chatTitle).toBe('Team Context Reminder');
    });

    it('should handle "You said:" role labels', () => {
        const result = parseChatGPTOutput(sampleOutput);
        const userMessages = result.messages.filter(m => m.role === 'user');
        expect(userMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle "ChatGPT said:" role labels', () => {
        const result = parseChatGPTOutput(sampleOutput);
        const assistantMessages = result.messages.filter(m => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter out noise like "Chat history"', () => {
        const noiseOutput = `[USER] Chat history
[USER] Search chats
[USER] Actual question here`;
        const result = parseChatGPTOutput(noiseOutput);
        const contents = result.messages.map(m => m.content);
        expect(contents).not.toContain('Chat history');
        expect(contents).not.toContain('Search chats');
    });

    it('should extract browser URL', () => {
        const result = parseChatGPTOutput(sampleOutput);
        expect(result.browserUrl).toBe('chatgpt.com/c/abc123');
    });
});

describe('Gemini Parser', () => {
    const sampleOutput = `[WINDOW_TITLE] Google Gemini - Brave - Work
[BROWSER_URL] gemini.google.com/u/3/app/880725c54adcc1b7
[CHAT_TITLE] System Check and Assistance Offered
[USER] Test
[ASSISTANT] System Check: Operational
[ASSISTANT] I am reading you loud and clear. Everything is working perfectly on my end.
[ASSISTANT] How can I assist you today?
[ASSISTANT] Would you like to start a new draft, brainstorm ideas, or search for information?`;

    it('should extract chat title', () => {
        const result = parseGeminiOutput(sampleOutput);
        expect(result.chatTitle).toBe('System Check and Assistance Offered');
    });

    it('should extract browser URL', () => {
        const result = parseGeminiOutput(sampleOutput);
        expect(result.browserUrl).toBe('gemini.google.com/u/3/app/880725c54adcc1b7');
    });

    it('should extract user message', () => {
        const result = parseGeminiOutput(sampleOutput);
        const userMessages = result.messages.filter(m => m.role === 'user');
        expect(userMessages.length).toBe(1);
        expect(userMessages[0]!.content).toBe('Test');
    });

    it('should combine consecutive assistant messages', () => {
        const result = parseGeminiOutput(sampleOutput);
        const assistantMessages = result.messages.filter(m => m.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]!.content).toContain('System Check: Operational');
        expect(assistantMessages[0]!.content).toContain('How can I assist you today?');
    });

    it('should filter out Gemini UI noise', () => {
        const noiseOutput = `[USER] Gemini
[USER] Chats
[USER] New chat
[USER] Actual user question`;
        const result = parseGeminiOutput(noiseOutput);
        expect(result.messages.length).toBe(1);
        expect(result.messages[0]!.content).toBe('Actual user question');
    });

    it('should handle window title', () => {
        const result = parseGeminiOutput(sampleOutput);
        expect(result.windowTitle).toBe('Google Gemini - Brave - Work');
    });
});

describe('Cross-platform isolation', () => {
    it('Claude Desktop parser should not use ChatGPT noise filtering', () => {
        // "Chat history" (exact match) should be filtered by ChatGPT but not Claude
        const input = `[USER] Chat history`;
        const claudeResult = parseClaudeDesktopOutput(input);
        const chatgptResult = parseChatGPTOutput(input);
        
        // Claude should keep it, ChatGPT should filter it
        expect(claudeResult.messages.length).toBe(1);
        expect(chatgptResult.messages.length).toBe(0);
    });

    it('Gemini parser should filter Gemini-specific noise that ChatGPT does not', () => {
        // "Show thinking" is Gemini-specific noise, not filtered by ChatGPT
        const input = `[USER] Show thinking`;
        const geminiResult = parseGeminiOutput(input);
        const chatgptResult = parseChatGPTOutput(input);
        
        // Gemini should filter it, ChatGPT should keep it
        expect(geminiResult.messages.length).toBe(0);
        expect(chatgptResult.messages.length).toBe(1);
    });

    it('Each parser should have independent state', () => {
        // Run parsers in sequence and verify no state leakage
        const input1 = `[USER] Message 1`;
        const input2 = `[ASSISTANT] Message 2`;
        
        parseClaudeDesktopOutput(input1);
        parseClaudeWebOutput(input1);
        parseChatGPTOutput(input1);
        parseGeminiOutput(input1);
        
        // Each subsequent call should start fresh
        const result = parseClaudeDesktopOutput(input2);
        expect(result.messages.length).toBe(1);
        expect(result.messages[0]!.role).toBe('assistant');
    });
});
