import { Operator } from '../Operator';
import { Subscriber } from '../Subscriber';
import { Observable } from '../Observable';
import { Subject } from '../Subject';
import { Subscription, TeardownLogic } from '../Subscription';
import { tryCatch } from '../util/tryCatch';
import { errorObject } from '../util/errorObject';

import { OuterSubscriber } from '../OuterSubscriber';
import { InnerSubscriber } from '../InnerSubscriber';
import { subscribeToResult } from '../util/subscribeToResult';

/**
 * Returns an Observable that mirrors the source Observable with the exception of a `complete`. If the source
 * Observable calls `complete`, this method will emit to the Observable returned from `notifier`. If that Observable
 * calls `complete` or `error`, then this method will call `complete` or `error` on the child subscription. Otherwise
 * this method will resubscribe to the source Observable.
 *
 * <img src="./img/repeatWhen.png" width="100%">
 *
 * @param {function(notifications: Observable): Observable} notifier - Receives an Observable of notifications with
 * which a user can `complete` or `error`, aborting the repetition.
 * @return {Observable} The source Observable modified with repeat logic.
 * @method repeatWhen
 * @owner Observable
 */
export function repeatWhen<T>(this: Observable<T>, notifier: (notifications: Observable<any>) => Observable<any>): Observable<T> {
  return this.lift(new RepeatWhenOperator(notifier));
}

class RepeatWhenOperator<T> implements Operator<T, T> {
  constructor(protected notifier: (notifications: Observable<any>) => Observable<any>) {
  }

  call(subscriber: Subscriber<T>, source: any): TeardownLogic {
    return source.subscribe(new RepeatWhenSubscriber(subscriber, this.notifier, source));
  }
}

/**
 * We need this JSDoc comment for affecting ESDoc.
 * @ignore
 * @extends {Ignored}
 */
class RepeatWhenSubscriber<T, R> extends OuterSubscriber<T, R> {

  private notifications: Subject<any>;
  private retries: Observable<any>;
  private retriesSubscription: Subscription;
  private sourceIsBeingSubscribedTo: boolean = true;

  constructor(destination: Subscriber<R>,
              private notifier: (notifications: Observable<any>) => Observable<any>,
              private source: Observable<T>) {
    super(destination);
  }

  notifyNext(outerValue: T, innerValue: R,
             outerIndex: number, innerIndex: number,
             innerSub: InnerSubscriber<T, R>): void {
    this.sourceIsBeingSubscribedTo = true;
    this.source.subscribe(this);
  }

  notifyComplete(innerSub: InnerSubscriber<T, R>): void {
    if (this.sourceIsBeingSubscribedTo === false) {
      return super.complete();
    }
  }

  complete() {
    this.sourceIsBeingSubscribedTo = false;

    if (!this.isStopped) {
      if (!this.retries) {
        this.subscribeToRetries();
      } else if (this.retriesSubscription.closed) {
        return super.complete();
      }

      this._unsubscribeAndRecycle();
      this.notifications.next();
    }
  }

  protected _unsubscribe() {
    const { notifications, retriesSubscription } = this;
    if (notifications) {
      notifications.unsubscribe();
      this.notifications = null;
    }
    if (retriesSubscription) {
      retriesSubscription.unsubscribe();
      this.retriesSubscription = null;
    }
    this.retries = null;
  }

  protected _unsubscribeAndRecycle(): Subscriber<T> {
    const { notifications, retries, retriesSubscription } = this;
    this.notifications = null;
    this.retries = null;
    this.retriesSubscription = null;
    super._unsubscribeAndRecycle();
    this.notifications = notifications;
    this.retries = retries;
    this.retriesSubscription = retriesSubscription;
    return this;
  }

  private subscribeToRetries() {
    this.notifications = new Subject();
    const retries = tryCatch(this.notifier)(this.notifications);
    if (retries === errorObject) {
      return super.complete();
    }
    this.retries = retries;
    this.retriesSubscription = subscribeToResult(this, retries);
  }
}
