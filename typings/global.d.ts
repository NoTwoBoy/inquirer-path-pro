import { Interface } from "readline";

export {};

declare global {
  interface InquirerReadLine extends Interface {
    line: string;
    cursor: number;
    input: NodeJS.ReadWriteStream;
    output: NodeJS.WriteStream & {
      mute(): void;
      unmute(): void;
    };
  }
}
