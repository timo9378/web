// @vitest-environment jsdom
//
// ui/ 元件從 React.forwardRef 改寫成普通函式（React 19 起 ref 是一般 prop）之後的回歸測試。
//
// 為什麼需要這個檔：改寫前後 tsc、build、eslint 全綠也證明不了 ref 真的到得了 DOM 節點——
// 型別上 React.ComponentProps<T> 含 ref，但「有沒有真的被 {...props} 展開到底層元素」是
// runtime 行為。這條路真的有人走：PostEditor 的 slug 與封面圖欄位是
// `<Input {...field} />`，react-hook-form 的 field.ref 就靠這條鏈到 <input>，
// 斷掉的話驗證失敗不會 focus 到該欄位，而且沒有任何靜態檢查會抓到。
import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { render, cleanup } from '@testing-library/react';

import { Input } from './input';
import { Textarea } from './textarea';
import { Button } from './button';
import { Label } from './label';
import { Card, CardContent } from './card';
import { Table, TableBody, TableCell, TableRow } from './table';
import { Checkbox } from './checkbox';
import { Switch } from './switch';

describe('ref 轉發到底層 DOM 節點', () => {
  it('Input（PostEditor 的 slug / 封面圖欄位走這條）', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="slug" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.placeholder).toBe('slug');
    cleanup();
  });

  it('Textarea', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    cleanup();
  });

  it('Button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>送出</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe('送出');
    cleanup();
  });

  it('Card / CardContent（純 div，型別從 HTMLAttributes 換成 ComponentProps）', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref}>
        <CardContent>內容</CardContent>
      </Card>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    cleanup();
  });

  it('Table / TableCell', () => {
    const table = createRef<HTMLTableElement>();
    const cell = createRef<HTMLTableCellElement>();
    render(
      <Table ref={table}>
        <TableBody>
          <TableRow>
            <TableCell ref={cell}>格子</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(table.current).toBeInstanceOf(HTMLTableElement);
    expect(cell.current?.textContent).toBe('格子');
    cleanup();
  });

  it('Label（Radix primitive）', () => {
    const ref = createRef<HTMLLabelElement>();
    render(<Label ref={ref}>標題</Label>);
    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
    cleanup();
  });

  it('Checkbox（Radix primitive，ref 落在 button 上）', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Checkbox ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    cleanup();
  });

  it('Switch（Radix primitive）', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Switch ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    cleanup();
  });
});

describe('callback ref 也要收得到（react-hook-form 用的就是這種）', () => {
  it('Input 透過展開傳入的 callback ref 會拿到 <input>', () => {
    // 模擬 `<Input {...field} />`：field 是物件，ref 混在其他 prop 裡一起展開。
    let node: HTMLInputElement | null = null;
    const field = {
      name: 'slug',
      value: 'hello',
      onChange: () => undefined,
      ref: (el: HTMLInputElement | null) => {
        node = el;
      },
    };
    render(<Input {...field} />);
    expect(node).toBeInstanceOf(HTMLInputElement);
    expect((node as unknown as HTMLInputElement).value).toBe('hello');
    cleanup();
  });
});
