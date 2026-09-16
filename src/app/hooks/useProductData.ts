/**
 * FETCH ONCE, HONESTLY.
 *
 * The shape every authenticated surface in MARQ Cortex used to hand-roll, and
 * hand-rolled differently — which is how eleven of them ended up with a `catch`
 * that substituted demo rows. There is one `catch` now, it lives here, and what
 * it produces is a REASON rather than a fixture.
 *
 *   const teams = useProductData(() => getTeamMembers(token), [token]);
 *
 *   <ProductDataState
 *     loading={teams.loading}
 *     reason={teams.reason}
 *     detail={teams.detail}
 *     empty={teams.isEmpty}
 *     subject="team members"
 *     onRetry={teams.reload}
 *   >
 *     …
 *   </ProductDataState>
 *
 * `data` is `null` in every state except REAL DATA. That is deliberate: a
 * surface cannot accidentally render a stale or invented value while showing an
 * error, because there is nothing there to render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifyProductDataError,
  isEmptyAnswer,
  type ProductDataReason,
} from '@/app/services/productData';

export interface ProductDataResult<T> {
  /** True while a first load (or a reload) is in flight with nothing to show. */
  loading: boolean;
  /** The real answer, or `null`. Never a fixture, in any state. */
  data: T | null;
  /** Why there is no data. `null` when the request succeeded. */
  reason: ProductDataReason | null;
  /** The server's own message, when it gave one. */
  detail: string | null;
  /** True when the request succeeded and the answer was "nothing yet". */
  isEmpty: boolean;
  /** Run the request again. */
  reload: () => void;
}

export interface UseProductDataOptions<T> {
  /**
   * Skip the request entirely — for a surface that has no session yet, or a
   * parameter it is still waiting for. The hook reports LOADING while skipped
   * rather than inventing an empty answer.
   */
  skip?: boolean;
  /**
   * How to decide EMPTY for this particular answer. The default treats `null`,
   * `[]` and `{}` as empty, which is wrong for a wrapper like
   * `{ success: true, submissions: [] }` — those pass a selector.
   */
  isEmpty?: (value: T) => boolean;
}

export function useProductData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  options: UseProductDataOptions<T> = {},
): ProductDataResult<T> {
  const { skip = false, isEmpty: isEmptyOverride } = options;

  const [state, setState] = useState<{
    loading: boolean;
    data: T | null;
    reason: ProductDataReason | null;
    detail: string | null;
  }>({ loading: !skip, data: null, reason: null, detail: null });

  const [nonce, setNonce] = useState(0);

  // The load function is almost always an inline arrow, so it is a new value on
  // every render. Keeping it in a ref means the effect runs on the declared
  // deps and not on every render — the difference between one request and an
  // infinite loop.
  const loadRef = useRef(load);
  loadRef.current = load;

  const emptyRef = useRef(isEmptyOverride);
  emptyRef.current = isEmptyOverride;

  useEffect(() => {
    if (skip) {
      setState({ loading: true, data: null, reason: null, detail: null });
      return;
    }

    let live = true;
    setState(previous => ({ ...previous, loading: true, reason: null, detail: null }));

    loadRef
      .current()
      .then(value => {
        if (!live) return;
        setState({ loading: false, data: value, reason: null, detail: null });
      })
      .catch(error => {
        if (!live) return;
        const classified = classifyProductDataError(error);
        // `data` is cleared, not kept. A surface showing an error must not also
        // be showing rows — that is how a failure gets mistaken for a success.
        setState({
          loading: false,
          data: null,
          reason: classified.reason,
          detail: classified.message || null,
        });
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip, nonce]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  const isEmpty =
    !state.loading &&
    state.reason === null &&
    (emptyRef.current && state.data != null
      ? emptyRef.current(state.data)
      : isEmptyAnswer(state.data));

  return {
    loading: state.loading,
    data: state.data,
    reason: state.reason,
    detail: state.detail,
    isEmpty,
    reload,
  };
}
