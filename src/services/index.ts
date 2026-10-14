// ---------------------------------------------------------------------------
// Service entry: exposes only the VS Code API adapter layer, so it can be swapped in tests and reached in one place.
// ---------------------------------------------------------------------------

import { IVSCodeService, VSCodeService } from './vscode';

export type { IVSCodeService } from './vscode';

export const services = {
    vscode: new VSCodeService() as IVSCodeService,
};

export const getVSCodeService = (): IVSCodeService => services.vscode;
