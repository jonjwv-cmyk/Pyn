declare module 'marked' {
  export function parse(src: string, options?: object): string;
  export function setOptions(options: object): void;
  const marked: {
    parse: (src: string, options?: object) => string;
    setOptions: (options: object) => void;
  };
  export default marked;
}
