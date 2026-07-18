// Registers the extensionless-import resolve hook for the Node test runner.
import { register } from 'node:module';
register('./ts-extension-hook.mjs', import.meta.url);
