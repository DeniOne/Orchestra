'use client';

import { useState } from 'react';
import type { RoundResponse } from '@orchestra/domain';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * UI Canon §1 — Conducting Score staves.
 * Горизонтальные дорожки ролей с РЕАЛЬНЫМ LLM контентом (НЕ chat-bubble — Canon §9.1).
 */
export function ScoreStaves({ responses }: { responses: RoundResponse[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">Агенты</h4>
      <div className="space-y-1.5">
        {responses.map((rr, i) => (
          <Stave key={`${rr.role.id}-${i}`} response={rr} />
        ))}
      </div>
    </div>
  );
}

function Stave({ response }: { response: RoundResponse }) {
  const [expanded, setExpanded] = useState(false);
  const content = response.response.content;
  const preview = content.length > 280 ? content.slice(0, 280) + '…' : content;

  return (
    <div className="rounded-md border border-border/60 bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">
            {response.role.displayName ?? response.role.id}
          </span>
          <span className={`block whitespace-pre-wrap break-words text-xs text-muted-foreground ${expanded ? '' : 'line-clamp-3'}`}>
            {expanded ? content : preview}
          </span>
        </div>
      </button>
    </div>
  );
}
