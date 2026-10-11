import { describe, it, expect, beforeEach } from 'vitest';
import { VSCodeService } from './vscode';

describe('VSCodeService', () => {
    let service: VSCodeService;

    beforeEach(() => {
        service = new VSCodeService();
    });

    it('should create service instance', () => {
        expect(service).toBeDefined();
    });

    it('should expose showInformationMessage method', () => {
        expect(typeof service.showInformationMessage).toBe('function');
    });

    it('should expose showWarningMessage method', () => {
        expect(typeof service.showWarningMessage).toBe('function');
    });

    it('should expose showErrorMessage method', () => {
        expect(typeof service.showErrorMessage).toBe('function');
    });

    it('should expose getConfiguration method', () => {
        expect(typeof service.getConfiguration).toBe('function');
    });

    it('should expose registerCommand method', () => {
        expect(typeof service.registerCommand).toBe('function');
    });

    it('should expose workspaceFolders property', () => {
        expect(service.workspaceFolders).toBeDefined();
    });

    it('should expose asRelativePath method', () => {
        expect(typeof service.asRelativePath).toBe('function');
    });

    it('should expose activeTextEditor property', () => {
        // activeTextEditor can be undefined when no editor is active
        expect('activeTextEditor' in service).toBe(true);
    });

    it('should expose clipboard property', () => {
        expect(service.clipboard).toBeDefined();
    });

    it('should expose language property', () => {
        expect(service.language).toBeDefined();
    });

    it('should expose appName property', () => {
        expect(service.appName).toBeDefined();
    });

    it('should expose version property', () => {
        expect(service.version).toBeDefined();
    });
});
