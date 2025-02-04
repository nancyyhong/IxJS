import { toObserver } from '../internal/toobserver';
import { AsyncIterableX } from './asynciterablex';
import { PartialAsyncObserver } from '../observer';

export class TapAsyncIterable<TSource> extends AsyncIterableX<TSource> {
  private _source: AsyncIterable<TSource>;
  private _observer: PartialAsyncObserver<TSource>;

  constructor(source: AsyncIterable<TSource>, observer: PartialAsyncObserver<TSource>) {
    super();
    this._source = source;
    this._observer = observer;
  }

  async *[Symbol.asyncIterator]() {
    const it = this._source[Symbol.asyncIterator]();
    while (1) {
      let next;
      try {
        next = await it.next();
      } catch (e) {
        if (this._observer.error) {
          await this._observer.error(e);
        }
        throw e;
      }

      if (next.done) {
        if (this._observer.complete) {
          await this._observer.complete();
        }
        break;
      }

      if (this._observer.next) {
        await this._observer.next(next.value);
      }
      yield next.value;
    }
  }
}

export function tap<TSource>(
  source: AsyncIterable<TSource>,
  observer: PartialAsyncObserver<TSource>
): AsyncIterableX<TSource>;

export function tap<TSource>(
  source: AsyncIterable<TSource>,
  next?: ((value: TSource) => any) | null,
  error?: ((err: any) => any) | null,
  complete?: (() => any) | null
): AsyncIterableX<TSource>;

export function tap<TSource>(
  source: AsyncIterable<TSource>,
  observerOrNext?: PartialAsyncObserver<TSource> | ((value: TSource) => any) | null,
  error?: ((err: any) => any) | null,
  complete?: (() => any) | null
): AsyncIterableX<TSource> {
  return new TapAsyncIterable<TSource>(source, toObserver(observerOrNext, error, complete));
}
