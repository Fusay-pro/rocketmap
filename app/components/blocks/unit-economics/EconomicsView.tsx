'use client';

import { useState } from 'react';
import type { BlockType, UnitEconomicsData, EconomicsModule } from '@/lib/types/canvas';
import { AlertsSection } from './AlertsSection';
import { EconomicsFlowDiagram } from './EconomicsFlowDiagram';
import { SegmentEconomicsCard } from './SegmentEconomicsCard';
import { SensitivityPanel } from './SensitivityPanel';

interface EconomicsViewProps {
  activeModule: EconomicsModule;
  economicsData: UnitEconomicsData | null;
  canvasId: string;
  blockType: BlockType;
  aiEnabled: boolean;
  isGenerating?: boolean;
  progress?: string | null;
  onGeneratingChange?: (generating: boolean, progress?: string) => void;
  onDataChange: (data: UnitEconomicsData) => void;
}

type EconomicsTab = 'overview' | 'sensitivity';

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function EconomicsView({
  activeModule,
  economicsData,
  canvasId,
  blockType,
  aiEnabled,
  isGenerating: isGeneratingProp,
  progress: progressProp,
  onGeneratingChange,
  onDataChange,
}: EconomicsViewProps) {
  const [tab, setTab] = useState<EconomicsTab>(
    activeModule === 'sensitivity_analysis' ? 'sensitivity' : 'overview'
  );
  const [localGenerating, setLocalGenerating] = useState(false);
  const [localProgress, setLocalProgress] = useState<string | null>(null);

  // Use lifted state if provided, otherwise local
  const isGenerating = isGeneratingProp ?? localGenerating;
  const progress = progressProp ?? localProgress;

  const setGenerating = (val: boolean, msg?: string) => {
    setLocalGenerating(val);
    setLocalProgress(msg ?? null);
    onGeneratingChange?.(val, msg);
  };

  const PROGRESS_STEPS = [
    'Reading canvas context...',
    'Estimating segment metrics...',
    'Calculating LTV & CAC...',
    'Detecting economic alerts...',
    'Finalizing analysis...',
  ];

  const handleGenerate = async () => {
    if (!aiEnabled) return;
    let stepIdx = 0;
    setGenerating(true, PROGRESS_STEPS[0]);
    const ticker = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, PROGRESS_STEPS.length - 1);
      setGenerating(true, PROGRESS_STEPS[stepIdx]);
    }, 8000);
    try {
      console.log(`[economics] POST /api/canvas/${canvasId}/blocks/${blockType}/deep-dive`);
      const res = await fetch(`/api/canvas/${canvasId}/blocks/${blockType}/deep-dive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: 'unit_economics', inputs: {} }),
      });
      const json = await res.json();
      console.log(`[economics] response status=${res.status}`, json);
      if (res.ok) {
        if (json.updatedDeepDive?.unitEconomics) {
          onDataChange(json.updatedDeepDive.unitEconomics);
        } else {
          console.warn('[economics] no unitEconomics in updatedDeepDive', json.updatedDeepDive);
        }
      } else {
        // Include the status: an error object alone can serialise to `{}` and
        // then says nothing about what actually went wrong.
        console.error(
          `[economics] request failed — HTTP ${res.status} ${res.statusText}:`,
          json?.error ?? json,
        );
      }
    } catch (err) {
      console.error('[economics] fetch threw:', err);
    } finally {
      clearInterval(ticker);
      setGenerating(false);
    }
  };

  const tabs: { key: EconomicsTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'sensitivity', label: 'Sensitivity' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`ui-tab-btn px-3 py-1.5 text-xs -mb-px border-b-2 rounded-none ${
              tab === t.key
                ? 'is-active border-foreground'
                : 'border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !aiEnabled}
        className={`ui-btn ui-btn-sm ui-btn-block ${
          isGenerating
            ? 'ui-btn-secondary glow-ai text-state-ai'
            : !aiEnabled
              ? 'ui-btn-ghost text-foreground-muted/40 cursor-not-allowed'
              : 'ui-btn-secondary text-foreground-muted hover:text-foreground'
        }`}
      >
        {isGenerating
          ? (progress ?? 'Generating economics...')
          : !aiEnabled
            ? 'Fill all blocks to unlock AI'
            : 'Generate Economics'}
      </button>

      {/* Content */}
      {!economicsData ? (
        <div className="text-center py-12 text-foreground-muted/50 text-sm">
          No economics data yet. Click &quot;Generate Economics&quot; to analyze your unit economics.
        </div>
      ) : tab === 'overview' ? (
        <div className="space-y-6 animate-in fade-in">
          {/* Alerts */}
          <AlertsSection alerts={economicsData.alerts} />

          {/* Per-segment flow diagrams */}
          {economicsData.segments.map((seg) => (
            <EconomicsFlowDiagram key={seg.segmentId} segment={seg} />
          ))}

          {/* Segment detail cards */}
          {economicsData.segments.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-foreground-muted uppercase tracking-wider">
                Segment Details
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {economicsData.segments.map((seg) => (
                  <SegmentEconomicsCard key={seg.segmentId} segment={seg} />
                ))}
              </div>
            </div>
          )}

          {/* Global metrics summary */}
          {economicsData.globalMetrics && (
            <div className="glass-morphism rounded-lg p-4 space-y-3">
              <h3 className="font-mono text-xs text-foreground-muted uppercase tracking-wider">
                Blended Metrics
              </h3>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">Blended ARPU</div>
                  <div className="text-foreground font-medium">{formatCurrency(economicsData.globalMetrics.blendedArpu)}/mo</div>
                </div>
                <div>
                  <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">Blended CAC</div>
                  <div className="text-foreground font-medium">{formatCurrency(economicsData.globalMetrics.blendedCac)}</div>
                </div>
                <div>
                  <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">Blended LTV</div>
                  <div className="text-foreground font-medium">{formatCurrency(economicsData.globalMetrics.blendedLtv)}</div>
                </div>
                <div>
                  <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">LTV/CAC Ratio</div>
                  <div className="text-foreground font-medium">{economicsData.globalMetrics.blendedLtvCacRatio.toFixed(1)}x</div>
                </div>
                {economicsData.globalMetrics.monthlyBurn != null && (
                  <div>
                    <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">Monthly Burn</div>
                    <div className="text-foreground font-medium">{formatCurrency(economicsData.globalMetrics.monthlyBurn)}</div>
                  </div>
                )}
                {economicsData.globalMetrics.runwayMonths != null && (
                  <div>
                    <div className="text-foreground-muted/50 text-[10px] uppercase tracking-wider">Runway</div>
                    <div className="text-foreground font-medium">{economicsData.globalMetrics.runwayMonths} months</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <SensitivityPanel
          economicsData={economicsData}
          canvasId={canvasId}
          blockType={blockType}
          onDataChange={onDataChange}
        />
      )}
    </div>
  );
}
