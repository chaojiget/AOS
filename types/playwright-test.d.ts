declare module "@playwright/test" {
  export interface PlaywrightTestArgs {
    page: any;
  }

  export type PlaywrightTest = (
    name: string,
    fn: (args: PlaywrightTestArgs) => void | Promise<void>,
  ) => void;

  export const test: PlaywrightTest & {
    describe: PlaywrightTest;
  };
  export const expect: any;
  export const devices: Record<string, any>;
  export function defineConfig(config: any): any;
}

