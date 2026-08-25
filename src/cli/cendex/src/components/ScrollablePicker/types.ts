export type Command = {
  title: string;
  value: string;
  description: string;
  category?: string;
  aliases?: string[];
  action: (...args: any[]) => void | Promise<void>;
};
