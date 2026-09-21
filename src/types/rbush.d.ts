declare module 'rbush' {
  interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  type Equality<T> = (a: T, b: T) => boolean;

  export default class RBush<T extends BoundingBox = BoundingBox> {
    constructor(maxEntries?: number);
    all(): T[];
    clear(): this;
    insert(item: T): this;
    load(items: T[]): this;
    remove(item: T, equalsFn?: Equality<T>): this;
    search(box: BoundingBox): T[];
  }
}
