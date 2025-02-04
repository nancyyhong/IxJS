import { AsyncSink } from './../asyncsink';
import { OperatorAsyncFunction } from '../interfaces';
import { bindCallback } from '../internal/bindcallback';
import { identityAsync } from '../internal/identity';
import { toLength } from '../internal/tolength';
import { Observable } from '../observer';
import {
  isArrayLike,
  isIterable,
  isIterator,
  isAsyncIterable,
  isReadableNodeStream,
  isWritableNodeStream
} from '../internal/isiterable';

/**
 * This class serves as the base for all operations which support [Symbol.asyncIterator].
 */
export abstract class AsyncIterableX<T> implements AsyncIterable<T> {
  abstract [Symbol.asyncIterator](): AsyncIterator<T>;

  async forEach(
    projection: (value: T, index: number) => void | Promise<void>,
    thisArg?: any
  ): Promise<void> {
    const fn = bindCallback(projection, thisArg, 2);
    let i = 0;
    for await (let item of this) {
      await fn(item, i++);
    }
  }

  pipe<R>(...operations: OperatorAsyncFunction<T, R>[]): AsyncIterableX<R>;
  pipe<R extends NodeJS.WritableStream>(writable: R, options?: { end?: boolean }): R;
  pipe<R>(...args: any[]) {
    let i = -1;
    let n = args.length;
    let acc: any = this;
    let as = AsyncIterableX.as;
    while (++i < n) {
      acc = as(args[i](acc));
    }
    return acc;
  }

  tee(): [ReadableStream<T>, ReadableStream<T>] {
    return this._getDOMStream().tee();
  }

  pipeTo(writable: WritableStream<T>, options?: PipeOptions) {
    return this._getDOMStream().pipeTo(writable, options);
  }

  pipeThrough<R extends ReadableStream<any>>(
    duplex: { writable: WritableStream<T>; readable: R },
    options?: PipeOptions
  ) {
    return this._getDOMStream().pipeThrough(duplex, options);
  }

  private _DOMStream?: ReadableStream<T>;
  private _getDOMStream(): ReadableStream<T> {
    return this._DOMStream || (this._DOMStream = this.publish().toDOMStream());
  }

  static as(source: string): AsyncIterableX<string>;
  static as<T extends AsyncIterableX<any>>(source: T): T;
  static as<T>(source: AsyncIterableInput<T>): AsyncIterableX<T>;
  static as<T>(source: T): AsyncIterableX<T>;
  /** @nocollapse */
  static as(source: any) {
    /* tslint:disable */
    if (source instanceof AsyncIterableX) {
      return source;
    }
    if (typeof source === 'string') {
      return new OfAsyncIterable([source]);
    }
    if (isIterable(source) || isAsyncIterable(source)) {
      return new FromAsyncIterable(source, identityAsync);
    }
    if (isPromise(source)) {
      return new FromPromiseIterable(source, identityAsync);
    }
    if (isObservable(source)) {
      return new FromObservableAsyncIterable(source, identityAsync);
    }
    if (isArrayLike(source)) {
      return new FromArrayIterable(source, identityAsync);
    }
    return new OfAsyncIterable([source]);
    /* tslint:enable */
  }

  /** @nocollapse */
  static from<TSource, TResult = TSource>(
    source: AsyncIterableInput<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult> = identityAsync,
    thisArg?: any
  ): AsyncIterableX<TResult> {
    const fn = bindCallback(selector, thisArg, 2);
    /* tslint:disable */
    if (isIterable(source) || isAsyncIterable(source)) {
      return new FromAsyncIterable<TSource, TResult>(source, fn);
    }
    if (isPromise(source)) {
      return new FromPromiseIterable<TSource, TResult>(source, fn);
    }
    if (isObservable(source)) {
      return new FromObservableAsyncIterable<TSource, TResult>(source, fn);
    }
    if (isArrayLike(source)) {
      return new FromArrayIterable<TSource, TResult>(source, fn);
    }
    if (isIterator(source)) {
      return new FromAsyncIterable<TSource, TResult>({ [Symbol.asyncIterator]: () => source }, fn);
    }
    throw new TypeError('Input type not supported');
    /* tslint:enable */
  }

  /** @nocollapse */
  static of<TSource>(...args: TSource[]): AsyncIterableX<TSource> {
    //tslint:disable-next-line
    return new OfAsyncIterable<TSource>(args);
  }
}

class FromArrayIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: ArrayLike<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: ArrayLike<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    let i = 0;
    const length = toLength((<ArrayLike<TSource>>this._source).length);
    while (i < length) {
      yield await this._selector(this._source[i], i++);
    }
  }
}

class FromAsyncIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: Iterable<TSource | PromiseLike<TSource>> | AsyncIterable<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: Iterable<TSource | PromiseLike<TSource>> | AsyncIterable<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    let i = 0;
    for await (let item of <AsyncIterable<TSource>>this._source) {
      yield await this._selector(item, i++);
    }
  }
}

class FromPromiseIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: PromiseLike<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: PromiseLike<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    const item = await this._source;
    yield await this._selector(item, 0);
  }
}

class FromObservableAsyncIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _observable: Observable<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    observable: Observable<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._observable = observable;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    const sink: AsyncSink<TSource> = new AsyncSink<TSource>();
    const subscription = this._observable.subscribe({
      next(value: TSource) {
        sink.write(value);
      },
      error(err: any) {
        sink.error(err);
      },
      complete() {
        sink.end();
      }
    });

    let i = 0;
    try {
      for (let next; !(next = await sink.next()).done; ) {
        yield await this._selector(next.value!, i++);
      }
    } finally {
      subscription.unsubscribe();
    }
  }
}

export type AsyncIterableInput<TSource> =
  | AsyncIterable<TSource>
  | AsyncIterator<TSource>
  | Iterable<TSource | PromiseLike<TSource>>
  | ArrayLike<TSource>
  | PromiseLike<TSource>
  | Observable<TSource>;

function isPromise(x: any): x is PromiseLike<any> {
  return x != null && Object(x) === x && typeof x['then'] === 'function';
}

function isObservable(x: any): x is Observable<any> {
  return x != null && Object(x) === x && typeof x['subscribe'] === 'function';
}

class OfAsyncIterable<TSource> extends AsyncIterableX<TSource> {
  private _args: TSource[];

  constructor(args: TSource[]) {
    super();
    this._args = args;
  }

  async *[Symbol.asyncIterator]() {
    for (let item of this._args) {
      yield item;
    }
  }
}

type WritableOrOperatorAsyncFunction<T, R> =
  | NodeJS.WritableStream
  | NodeJS.ReadWriteStream
  | OperatorAsyncFunction<T, R>;

declare module '../asynciterable/asynciterablex' {
  interface AsyncIterableX<T> {
    pipe(): AsyncIterableX<T>;
    pipe<A>(op1: OperatorAsyncFunction<T, A>): AsyncIterableX<A>;
    pipe<A, B>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>
    ): AsyncIterableX<B>;
    pipe<A, B, C>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>
    ): AsyncIterableX<C>;
    pipe<A, B, C, D>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>
    ): AsyncIterableX<D>;
    pipe<A, B, C, D, E>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>
    ): AsyncIterableX<E>;
    pipe<A, B, C, D, E, F>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>
    ): AsyncIterableX<F>;
    pipe<A, B, C, D, E, F, G>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>
    ): AsyncIterableX<G>;
    pipe<A, B, C, D, E, F, G, H>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>,
      op8: OperatorAsyncFunction<G, H>
    ): AsyncIterableX<H>;
    pipe<A, B, C, D, E, F, G, H, I>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>,
      op8: OperatorAsyncFunction<G, H>,
      op9: OperatorAsyncFunction<H, I>
    ): AsyncIterableX<I>;
    pipe(...operations: OperatorAsyncFunction<any, any>[]): AsyncIterableX<{}>;
    pipe<A extends NodeJS.WritableStream>(op1: A, options?: { end?: boolean }): A;
  }
}

try {
  (isBrowser => {
    if (isBrowser) {
      return;
    }

    const as = AsyncIterableX.as;
    AsyncIterableX.prototype.pipe = nodePipe;
    const readableOpts = (x: any, opts = x._writableState || { objectMode: true }) => opts;

    function nodePipe<T>(this: AsyncIterableX<T>, ...args: any[]) {
      let i = -1;
      let end: boolean;
      let n = args.length;
      let prev: any = this;
      let next: WritableOrOperatorAsyncFunction<T, any>;
      while (++i < n) {
        next = args[i];
        if (typeof next === 'function') {
          prev = as(next(prev));
        } else if (isWritableNodeStream(next)) {
          ({ end = true } = args[i + 1] || {});
          // prettier-ignore
          return isReadableNodeStream(prev) ? prev.pipe(next, {end}) :
             prev.toNodeStream(readableOpts(next)).pipe(next, {end});
        }
      }
      return prev;
    }
  })(typeof window === 'object' && typeof document === 'object' && document.nodeType === 9);
} catch (e) {
  /* */
}
