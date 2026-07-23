declare module "duix-guiji" {
  type DuixReturn = { err?: unknown; data?: unknown } | void;

  export default class DUIX {
    init(option: { sign: string; containerLable: string }): Promise<DuixReturn>;
    start(option: {
      conversationId: string;
      muted: boolean;
      openAsr: boolean;
      wipeGreen: boolean;
    }): Promise<DuixReturn>;
    speak(option: { content: string; interrupt: boolean }): Promise<DuixReturn>;
    break?: () => unknown;
    stop(): unknown;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
  }
}
