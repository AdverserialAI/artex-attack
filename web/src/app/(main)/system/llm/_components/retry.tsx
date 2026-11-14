"use client";

// Shared LLM retry config: "attempts + interval" for each of the five retry layers.
// Purpose: shared form components for the five-layer LLM retry config (RetryRuleFields / ProfileRetryFields / RetryPolicyPanel).
//
// Five layers, inner to outer: connect (SDK) → empty response (SDK) → same-provider safety window → poll circuit breaker → intent rerun.
// The first three layers follow the endpoint, so each model profile can override the global default; the last two are process-level and exist only globally.
//
// All inputs follow the same "empty = not configured" semantics, consistent with the backend db.RetryRule:
//   attempts  empty/0 = built-in default | -1 = disable this retry layer | >0 = use this many attempts
//   interval  empty/0 = this layer's original exponential backoff | >0 = use this fixed millisecond interval instead
//
// Main functions/types:
//   - ZERO_RULE / ZERO_OVERRIDE / ZERO_POLICY: zero-value constants for the "empty = not configured" semantics
//   - RETRY_LAYERS: metadata for the five retry layers (title / trigger conditions / defaults)
//   - RetryRuleFields: single-layer "attempts + interval" form controls
//   - ProfileRetryFields: three-layer override form inside the model profile drawer
//   - RetryPolicyPanel: the "Retry & Backoff" tab — global defaults panel for all five layers
//   - humanMs / NumField: millisecond display and controlled numeric input

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** Where this retry layer happens and who executes it */
  where: string;
  /** Which errors reach this layer — specific status codes, no guessing required */
  trigger: string;
  /** Similar-looking errors that do NOT reach this layer, so users don't think a config is broken when nothing happens */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** Default attempts when left empty, used as the placeholder */
  defAttempts: number;
  /** Default interval strategy when left empty, used as the placeholder */
  defInterval: string;
  /** What -1 in attempts means */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: "Connect retry",
    where: "SDK · before a 200 is received",
    trigger:
      "Cannot connect or no 200 yet: connection reset / read-write timeouts / DNS failures and other network errors, plus HTTP 408, 429, 500, 502, 503, 504.",
    skips: "All other status codes (400 / 401 / 403 / 404 / 413 / 422, etc.) are deterministic rejections — resending fails identically, so they're thrown immediately.",
    desc: "Resends the identical request. Once the stream has started (a 200 was received), mid-stream drops are no longer this layer's concern.",
    attemptsLabel: "Retry attempts",
    defAttempts: 3,
    defInterval: "0.5s→1s→2s exponential (capped at 8s)",
    offHint: "-1 = never retry; failures throw immediately",
  },
  empty: {
    title: "Empty-response retry",
    where: "SDK · openai format only",
    trigger:
      "HTTP 200 with a normal stop finish_reason, but the entire response has no content blocks — empty gateway frames, dropped thinking fields, sampling hiccups all look like this.",
    skips: "Empty content caused by max_tokens truncation doesn't count (fix that by raising the output cap; resending just hits it again).",
    desc: "Resends the whole prompt, which is expensive on long contexts — keep attempts low.",
    attemptsLabel: "Retry attempts",
    defAttempts: 2,
    defInterval: "0.5s→1s→2s exponential (capped at 8s)",
    offHint: "-1 = return empty responses as-is",
  },
  stream: {
    title: "Same-provider safety-window retry",
    where: "This project · before any output is delivered",
    trigger:
      "Failures after the stream is established (200 received): mid-stream disconnects, provider overload, in-stream 429 / 5xx error events — and not a single token delivered to the caller yet.",
    skips:
      "Quota exhaustion (402 / insufficient_quota — handled by profile rotation), context too long (413 / context length — handled by compaction), and deterministic rejections 400 / 401 / 403 / 404 / 422 are not retried.",
    desc: "Replays the same request on the same profile. Since nothing has been delivered, replaying cannot duplicate model output or tool execution.",
    attemptsLabel: "Retry attempts",
    defAttempts: 2,
    defInterval: "0.5s→1s exponential (capped at 4s)",
    offHint: "-1 = dropped streams go straight to the outer intent rerun",
  },
  breaker: {
    title: "Poll circuit breaker",
    where: "This project · process-level, one global policy",
    trigger:
      "Breaks when transient failures (429, 5xx, network errors) accumulate to the threshold in a row; deterministic failures like insufficient balance (402), invalid key (401 / 403), or nonexistent model (404) trip immediately, regardless of the threshold.",
    skips: "A single success resets the counter, so an occasionally flaky profile never accumulates into a trip.",
    desc: "After tripping, the profile enters a cooldown and polling skips it. State is persisted and survives restarts.",
    attemptsLabel: "Consecutive failures before tripping",
    defAttempts: 3,
    defInterval: "1min→5min→30min ladder",
    offHint: "-1 = transient failures never trip (deterministic failures still trip)",
  },
  intent: {
    title: "Intent rerun",
    where: "This project · process-level, one global policy",
    trigger:
      "All inner layers failed to save it: the worker ends with model_error — every inner retry exhausted, or the stream dropped after output delivery had begun (replaying is unsafe then, so the whole intent restarts).",
    skips: "Quota exhaustion is already handled by profile rotation and is not rerun here; pause/abort/wrap-up preempts immediately without consuming backoff time.",
    desc: "Reruns the entire intent from scratch. As the outermost layer, one rerun multiplies the attempt counts of all inner layers.",
    attemptsLabel: "Rerun attempts",
    defAttempts: 2,
    defInterval: "fixed 3s",
    offHint: "-1 = no rerun; the intent is marked blocked directly",
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** Human-readable milliseconds, displayed beside the input so users don't count zeros. */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** Controlled numeric input: empty string ↔ 0; intermediate states ("-", "1e") stay local without disturbing the parent. */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Follow when the parent swaps in a whole new value set (policy loaded, profile switched); typing locally never reaches this path,
  // because by then value already equals the parsed result of the local text.
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** The two knobs of one retry layer. idPrefix keeps label htmlFor unique when several layers appear on one page. */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = compact variant for the profile drawer: skips the expanded explanation, keeping only "which errors reach this layer" */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* Which errors reach this layer, down to status codes — if turning the knobs does nothing, the errors likely don't land in this layer at all. */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">Triggers</span>: {meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Not this layer</span>: {meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={`Default ${meta.defAttempts}`}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            Interval (ms)
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder="Default backoff"
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">{human ? `fixed ${human}` : meta.defInterval}</span>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground text-xs">Empty = default; {meta.offHint}.</p>}
    </div>
  );
}

/** The three override layers in the model profile drawer (the ones that follow the endpoint). */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">Retry overrides</Label>
        <p className="text-muted-foreground text-xs">
          Applies to this profile only, overriding the global defaults in "Retry & Backoff". Empty field = follow global; attempts -1 = disable that retry layer;
          a filled interval replaces exponential backoff with a fixed one. Circuit breaking and intent reruns are process-level and can only be tuned on the global page.
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** The "Retry & Backoff" tab: global defaults for all five layers. */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(`Failed to load retry policy: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The backend clamps out-of-range values and returns them; refresh directly from the response so what you see is what was stored.
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success("Saved — effective immediately (calls already in flight keep the old parameters)");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading retry policy…
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        A failed model call passes through five retry layers, inner to outer:
        <span className="text-foreground"> connect → empty response → same-provider safety window → poll circuit breaker → intent rerun</span>
        . Outer layers only run after inner ones are exhausted, so attempt counts
        <span className="text-foreground">multiply</span>
        — max out every layer and a single hiccup can burn dozens of requests.
        Leaving everything empty keeps the current defaults, exactly as if this page didn't exist. The first three layers can be overridden per model profile.
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          Save
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          Reset all to defaults
        </Button>
      </div>
    </div>
  );
}
