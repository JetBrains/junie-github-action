import { describe, it, expect } from 'bun:test';
import {extractJunieArgs, junieArgsToString} from "../../src/utils/junie-args-parser";

describe('extractJunieArgs', () => {
    it('should extract single junie-args from text', () => {
        const text = `@junie-agent create txt file
junie-args: --model="gpt-5" --other-param="value"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"', '--other-param="value"']);
        expect(result.cleanedText).toBe('@junie-agent create txt file');
    });

    it('should extract junie-args with single quotes', () => {
        const text = `Do something
junie-args: --model='claude-sonnet-4-5'`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(["--model='claude-sonnet-4-5'"]);
        expect(result.cleanedText).toBe('Do something');
    });

    it('should extract junie-args without quotes', () => {
        const text = `Task description
junie-args: --model=gpt-5 --flag=true`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model=gpt-5', '--flag=true']);
        expect(result.cleanedText).toBe('Task description');
    });

    it('should extract multiple junie-args blocks', () => {
        const text = `First instruction
junie-args: --model="gpt-5"

Some other text
junie-args: --other-param="value"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"', '--other-param="value"']);
        expect(result.cleanedText).toContain('First instruction');
        expect(result.cleanedText).toContain('Some other text');
        expect(result.cleanedText).not.toContain('junie-args:');
    });

    it('should handle text without junie-args', () => {
        const text = 'Just a regular comment without any special args';

        const result = extractJunieArgs(text);

        expect(result.args).toEqual([]);
        expect(result.cleanedText).toBe(text);
    });

    it('should handle null and undefined', () => {
        expect(extractJunieArgs(null).args).toEqual([]);
        expect(extractJunieArgs(undefined).args).toEqual([]);
        expect(extractJunieArgs(null).cleanedText).toBe('');
        expect(extractJunieArgs(undefined).cleanedText).toBe('');
    });

    it('should handle empty string', () => {
        const result = extractJunieArgs('');

        expect(result.args).toEqual([]);
        expect(result.cleanedText).toBe('');
    });

    it('should extract args with spaces in quoted values', () => {
        const text = `Task
junie-args: --model="gpt 5 turbo" --description="some long description"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt 5 turbo"', '--description="some long description"']);
        expect(result.cleanedText).toBe('Task');
    });

    it('should handle junie-args at the beginning', () => {
        const text = `junie-args: --model="gpt-5"
Do the task`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"']);
        expect(result.cleanedText).toBe('Do the task');
    });

    it('should handle junie-args at the end', () => {
        const text = `Do the task
junie-args: --model="gpt-5"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"']);
        expect(result.cleanedText).toBe('Do the task');
    });

    it('should clean up excessive whitespace after removal', () => {
        const text = `First line


junie-args: --model="gpt-5"


Last line`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"']);
        // Should normalize multiple newlines
        expect(result.cleanedText.split('\n\n').length).toBeLessThanOrEqual(2);
        expect(result.cleanedText).toContain('First line');
        expect(result.cleanedText).toContain('Last line');
    });

    it('should handle multiline args format', () => {
        const text = `Task description
junie-args:
  --model="gpt-5"
  --other="value"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"', '--other="value"']);
        expect(result.cleanedText).toBe('Task description');
    });

    it('should extract from PR comment scenario', () => {
        const text = `@junie-agent please implement the feature
junie-args: --model="claude-opus-4-5"

Additional context here`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="claude-opus-4-5"']);
        expect(result.cleanedText).toContain('@junie-agent please implement the feature');
        expect(result.cleanedText).toContain('Additional context here');
        expect(result.cleanedText).not.toContain('junie-args:');
    });

    it('should extract from custom prompt scenario', () => {
        const text = `code-review junie-args: --model="gpt-5" --other-param="test"`;

        const result = extractJunieArgs(text);

        expect(result.args).toEqual(['--model="gpt-5"', '--other-param="test"']);
        expect(result.cleanedText).toBe('code-review');
    });
});

describe('junieArgsToString', () => {
    it('should convert array to string', () => {
        const args = ['--model="gpt-5"', '--other="value"'];
        const result = junieArgsToString(args);

        expect(result).toBe('--model="gpt-5" --other="value"');
    });

    it('should handle empty array', () => {
        const result = junieArgsToString([]);

        expect(result).toBe('');
    });

    it('should handle single arg', () => {
        const args = ['--model="gpt-5"'];
        const result = junieArgsToString(args);

        expect(result).toBe('--model="gpt-5"');
    });
});
