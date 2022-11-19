import * as fs from 'fs';
import Func, { Options } from './func';
import { Cache } from './utils';

class Template {
  private readonly TOKEN_REGEX = `({#|#}|@{{|{{!|!}}|{{|}}|\@if|@elseif|@else|\@endif|@for|@endfor|@include)`;
  private TOKEN_TYPE: symbol | string | null = null;
  private readonly ESCAPE: symbol = Symbol();
  private readonly COMMENT: symbol = Symbol();
  private readonly RAW: symbol = Symbol();
  private readonly IF: string = '@if';
  private readonly ELSEIF: string = '@elseif';
  private readonly ELSE: string = '@else';
  private readonly ENDIF: string = '@endif';
  private readonly FOR: string = '@for';
  private readonly ENDFOR: string = '@endfor';
  private readonly INCLUDE: string = '@include';
  private readonly IGNORE_TAG: string = '@{{';

  private source = '';

  public constructor(private template: string, private options: Options = {}) {}

  /** Prepare template for parsing */
  private tokenize(): string[] {
    let temp: string = this.template;
    const tokens = [];
    const regex = new RegExp(this.TOKEN_REGEX);
    let result = regex.exec(temp);
    while (result) {
      const searchIndex = result.index;
      const token = result[0];
      if (searchIndex !== 0) {
        tokens.push(temp.substring(0, searchIndex));
        temp = temp.slice(searchIndex);
      }
      tokens.push(token);
      temp = temp.slice(token.length);
      switch (token) {
        case this.IF:
        case this.ELSEIF:
        case this.FOR:
        case this.INCLUDE:
          const nextToken = temp.substring(0, this.nextTokenEndIndex(temp));
          tokens.push(nextToken);
          temp = temp.slice(nextToken.length);
          break;
        default:
          break;
      }
      result = regex.exec(temp);
    }

    // If there's nothing to tokenize, then it's one giant array element
    if (temp) {
      tokens.push(temp);
    }
    return tokens;
  }

  /**
   * Use to get tokens fter an @if or @else token
   * For example, say we have @if(2 > 1)
   * this function will help get "(2 > 1)"
   * @param template
   * @returns index +1
   */
  private nextTokenEndIndex(template: string): number {
    for (let i = 0; i < template.length; i++) {
      if (template[i] === ')') {
        return i + 1;
      }
    }

    throw new Error('Closing bracket for @ statement not found');
  }

  /**
   * Parse template tokens to javascript
   */
  private parseToken(token: string): void {
    switch (token) {
      case this.IGNORE_TAG:
        this.TOKEN_TYPE = this.IGNORE_TAG;
        break;
      case '{{':
        this.TOKEN_TYPE = this.ESCAPE;
        break;
      case '}}':
        this.TOKEN_TYPE = null;
        break;
      case '{{!':
        this.TOKEN_TYPE = this.RAW;
        break;
      case '!}}':
        this.TOKEN_TYPE = null;
        break;
      case '{#':
        this.TOKEN_TYPE = this.COMMENT;
        break;
      case '#}':
        this.TOKEN_TYPE = null;
        break;
      case this.IF:
        this.TOKEN_TYPE = this.IF;
        break;
      case this.ELSEIF:
        this.TOKEN_TYPE = this.ELSEIF;
        break;
      case this.ELSE:
        this.source += `} else { `;
        this.TOKEN_TYPE = null;
        break;
      case this.ENDIF:
      case this.ENDFOR:
        this.source += `}`;
        this.TOKEN_TYPE = null;
        break;
      case this.FOR:
        this.TOKEN_TYPE = this.FOR;
        break;
      case this.INCLUDE:
        this.TOKEN_TYPE = this.INCLUDE;
        break;
      default:
        if (this.TOKEN_TYPE) {
          switch (this.TOKEN_TYPE) {
            case this.IGNORE_TAG:
              this.source += this.source += '_append(`' + '{{' + token + '}}' + '`);';
              break;
            case this.ESCAPE:
              this.source += ` _append(this.escape(${token}));`;
              break;
            case this.RAW:
              this.source += ` _append(${token});`;
              break;
            case this.COMMENT:
              // Do nothing
              break;
            case this.IF:
              this.source += `if ${token} {`;
              this.TOKEN_TYPE = null;
              break;
            case this.ELSEIF:
              this.source += `} else if ${token} {`;
              this.TOKEN_TYPE = null;
              break;
            case this.FOR:
              this.source += `for ${token} {`;
              this.TOKEN_TYPE = null;
              break;
            case this.INCLUDE:
              this.source += ` _append(this.include${token});`;
              this.TOKEN_TYPE = null;
              break;
          }
        } else {
          this.source += '_append(`' + token + '`);';
        }
        break;
    }
  }

  public compile(): Func {
    const self = this;
    let code = '';
    let prepend = ' ';
    let append = '';
    const tokens = this.tokenize();

    const closes: Record<string, string> = {
      '{{': '}}',
      '@{{': '}}',
      '{{!': '!}}',
      '@if': '@endif',
      '@for': '@endfor',
    };
    const stack: string[] = [];

    tokens.forEach((token) => {
      if (Object.keys(closes).includes(token)) {
        stack.push(token);
      } else if (Object.values(closes).includes(token) && closes[String(stack[stack.length - 1])] === token) {
        stack.pop();
      } else if (Object.values(closes).includes(token) && closes[String(stack[stack.length - 1])] !== token) {
        throw new Error(`Opening tag for ${token} not found`);
      }
      self.parseToken(token);
    });

    if (stack.length > 0) {
      throw new Error(`Matching tag for ${stack[0]} not found`);
    }

    prepend += `let _output = '';
        function _append(str){if(str) return _output += str}`;

    append += `return _output;`;
    code = prepend + this.source + append;
    const func = new Func(code, this.options);
    return func;
  }
}

export function render(template: string, data: Record<any, any> = {}): string {
  const tmpl = new Template(template);
  const fn = tmpl.compile();
  fn.setData(data);
  return fn.compile().exec();
}

export function renderFile(filePath: string, data: Record<any, any> = {}): string {
  let fn: any = Cache.get(filePath);
  if (!fn) {
    const template = fs.readFileSync(filePath).toString();
    const tmpl = new Template(template, { filePath });
    fn = tmpl.compile();
  }
  fn.setData(data);
  const result = fn.compile().exec();
  return result;
}

export function __express(
  filePath: string,
  options: Record<any, any> = {},
  callback: (err: unknown, data?: string) => void,
) {
  try {
    const rendered = renderFile(filePath, options);
    return callback(null, rendered);
  } catch (error: unknown) {
    return callback(error);
  }
}
