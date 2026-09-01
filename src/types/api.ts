/**
 * API Contract Types — BINANCE AI FUTURES AGENT v0.1
 *
 * These types define the data contract between the frontend dashboard
 * and the backend API layer. All API responses must conform to these types.
 *
 * The frontend imports these types but NEVER imports from mock.ts directly.
 * Data flows through the data adapter layer.
 */

// ─── Account & Portfolio ──────────────────────────────────────────────

export type Account = {
  id: string;
  name: string;
  balance: number;
  equity: number;
  availableMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  currency: "USDT";
  createdAt: string;
};

// ─── Market Data ──────────────────────────────────────────────────────

export type Candle = {
  t: string; // timestamp or time label
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
};

export type MarketTicker = {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  fundingRate: number;
  nextFundingTime: string;
  openInterest: number;
  openInterestChange: number;
};

export type OrderBookLevel = {
  price: number;
  bid: number;
  ask: number;
};

export type CorrelationData = {
  symbol: string;
  correlation: number;
};

// ─── Trading ──────────────────────────────────────────────────────────

export type PositionSide = "LONG" | "SHORT";

export type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  leverage: number;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  margin: number;
  openedAt: string;
};

export type OrderStatus =
  | "PENDING"
  | "OPEN"
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED";

export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";

export type Order = {
  id: string;
  symbol: string;
  side: PositionSide;
  type: OrderType;
  price: number | null;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  strategyId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Trade = {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  duration: string;
  strategyName: string;
  strategyVersion: string;
  openId: string;
  closeId: string;
  openedAt: string;
  closedAt: string;
};

// ─── Strategies ───────────────────────────────────────────────────────

export type StrategyState = "ACTIVE" | "SHADOW" | "PROBATION" | "DEPRECATED";

export type Strategy = {
  id: string;
  name: string;
  version: string;
  state: StrategyState;
  allocationPercent: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  description: string;
  createdAt: string;
  updatedAt: string;
};

// ─── AI Intelligence ──────────────────────────────────────────────────

export type MarketRegime =
  | "TRENDING — BULL EXPANSION"
  | "TRENDING — BEAR EXPANSION"
  | "RANGING"
  | "VOLATILE"
  | "LOW LIQUIDITY";

export type DecisionAction = "OPEN LONG" | "OPEN SHORT" | "CLOSE" | "HOLD" | "NO TRADE";

export type AiDecision = {
  action: DecisionAction;
  symbol: string;
  size: string;
  confidence: number;
  strategyName: string;
  strategyVersion: string;
  strategyEdge: number;
  reasoningSteps: string[];
  timestamp: string;
};

export type AiIntelligence = {
  confidence: number;
  regime: MarketRegime;
  regimeConfidence: number;
  decision: AiDecision;
  signals: SignalData[];
  marketAnalysis: string[];
  technicalIndicators: TechnicalIndicator[];
};

export type SignalData = {
  label: string;
  value: number;
};

export type TechnicalIndicator = {
  name: string;
  value: string;
  state: "bull" | "bear" | "neutral" | "warn";
};

// ─── AI Learning ──────────────────────────────────────────────────────

export type ExperienceTag = "PATTERN" | "RISK" | "TIMING" | "EXIT" | "REGIME" | "GENERAL";

export type AiExperience = {
  id: string;
  tag: ExperienceTag;
  title: string;
  confidence: number;
  impact: string;
  details: string;
  tradeIds: string[];
  createdAt: string;
};

export type AiLesson = {
  id: string;
  text: string;
  cycle: number;
  sourceExperienceIds: string[];
  createdAt: string;
};

export type AiTimelineEvent = {
  id: string;
  cycle: string;
  timestamp: string;
  title: string;
  detail: string;
};

export type AiImprovementData = {
  cycle: string;
  accuracy: number;
  profitFactor: number;
};

// ─── AI Audit ─────────────────────────────────────────────────────────

export type AuditMonth = {
  month: string;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  decisionQuality: number;
};

export type AiEvolution = {
  generation: string;
  label: string;
  score: number;
};

export type AiModel = {
  id: string;
  name: string;
  version: string;
  state: "ACTIVE" | "CANDIDATE" | "ARCHIVED";
  accuracy: number;
  profitFactor: number;
  trainingCycles: number;
  createdAt: string;
};

export type AiExperiment = {
  id: string;
  name: string;
  hypothesis: string;
  state: "RUNNING" | "COMPLETED" | "FAILED" | "REJECTED";
  startDate: string;
  endDate: string | null;
  sampleSize: number;
  controlWinRate: number;
  treatmentWinRate: number;
  confidence: number;
  conclusion: string | null;
};

// ─── Risk ─────────────────────────────────────────────────────────────

export type RiskStatus = "NOMINAL" | "ELEVATED" | "LIMIT_REACHED" | "EMERGENCY_STOP";

export type RiskEnvelope = {
  dailyProfitCap: number;
  dailyProfitUsed: number;
  dailyLossLimit: number;
  dailyLossUsed: number;
  totalExposure: number;
  maxExposure: number;
  currentLeverage: number;
  maxLeverage: number;
  status: RiskStatus;
  emergencyStopState: "ARMED" | "TRIGGERED" | "DISABLED";
  openPositionCount: number;
  marginRatio: number;
};

export type RiskEvent = {
  id: string;
  type: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  message: string;
  details: string;
  timestamp: string;
};

// ─── System ───────────────────────────────────────────────────────────

export type SystemNodeState = "ONLINE" | "OFFLINE" | "TRAINING" | "ERROR";

export type SystemNode = {
  name: string;
  state: SystemNodeState;
  latency: string;
  detail: string;
};

export type SystemConfig = {
  initialCapital: number;
  dailyProfitCap: number;
  dailyLossLimit: number;
  maxLeverage: number;
  maxExposurePercent: number;
  binanceTestnetEnabled: boolean;
  paperTradingMode: boolean;
  tradingEnabled: boolean;
};

// ─── API Response Wrappers ────────────────────────────────────────────

export type ApiResponse<T> = {
  data: T;
  timestamp: string;
  source: "mock" | "database" | "live";
};

// ─── Market Feed Status (Phase 8B) ──────────────────────────────────

export type FeedState = "ONLINE" | "DEGRADED" | "STALE" | "OFFLINE";

export type SymbolFeedStatus = {
  symbol: string;
  feedState: FeedState;
  lastUpdate: number; // epoch ms
  dataAgeMs: number; // ms since last update, Infinity if never
  candleCount: number;
  trend: string;
  price: number;
  change24h: number;
};

// ─── Paper Trading Status (Phase 8B) ─────────────────────────────────

export type PaperPositionStatus = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  margin: number;
  openedAt: string;
  durationMinutes: number;
};

export type PaperTradeSummary = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  closedAt: string;
  strategyName: string;
};

export type PaperStatusResponse = {
  // Paper trading mode
  mode: "PAPER";
  capital: number;
  initialCapital: number;
  totalPnl: number;
  dailyPnl: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;

  // Current position
  activePosition: PaperPositionStatus | null;

  // Recent trades
  recentTrades: PaperTradeSummary[];

  // Feed status
  feedState: FeedState;
  feedSymbols: SymbolFeedStatus[];

  // Latest AI decision
  lastAiDecision: {
    action: string;
    symbol: string;
    confidence: number;
    strategyName: string;
    timestamp: string;
  } | null;

  // Safety
  riskEngineStatus: string;
  emergencyStopState: string;
  noRealTrading: true;
};

// ─── Dashboard Response ──────────────────────────────────────────────

export type DashboardResponse = {
  account: Account;
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  tradeCount: number;
  status: string;
  uptime: string;
  currentPrice: number;
  recentTrades: Trade[];
  riskEnvelope: RiskEnvelope;
  aiDecision: AiDecision;
  candles: Candle[];
};

// ─── Runtime Response ────────────────────────────────────────────────

export type RuntimeResponse = {
  aiIntelligence: AiIntelligence;
  position: Position | null;
  strategyPerformance: Strategy[];
  uptime: string;
  tradingStatus: string;
};

// ─── Performance Response ────────────────────────────────────────────

export type PerformanceResponse = {
  equityCurve: { date: string; equity: number; benchmark: number }[];
  monthlyAudit: AuditMonth[];
  aiEvolution: AiEvolution[];
  improvementData: AiImprovementData[];
};

// ─── Trade Experience (Phase 5) ──────────────────────────────────────

export type TradeOutcome =
  | "WIN"
  | "LOSS"
  | "BREAKEVEN"
  | "CANCELLED"
  | "INVALID"
  | "NO_TRADE_SKIPPED"
  | "NO_TRADE_RISK_REJECTED";

export type MarketContext = {
  symbol: string;
  price: number;
  trend: string;
  trendStrength: number;
  momentum: string;
  momentumScore: number;
  volatility: number;
  volume24h: number;
  marketRegime: string;
  regimeConfidence: number;
  dataQuality: string;
  feedStatus: string;
};

export type TradeExperience = {
  id: string;
  decisionId: string;
  tradeId: string | null;
  symbol: string;
  timestamp: number;
  marketRegime: string;
  strategy: string;
  direction: "LONG" | "SHORT" | "NO_TRADE";
  confidence: number;
  entryPrice: number | null;
  exitPrice: number | null;
  duration: number | null;
  fees: number | null;
  slippage: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  outcome: TradeOutcome;
  marketContext: MarketContext;
  decisionVersion: string;
  modelVersion: string;
};

export type ExperienceStats = {
  totalExperiences: number;
  totalTrades: number;
  totalNoTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  averageConfidence: number;
  byStrategy: Record<string, { count: number; winRate: number; pnl: number }>;
  byRegime: Record<string, { count: number; winRate: number; pnl: number }>;
};

export type LessonCategory =
  | "REGIME"
  | "STRATEGY"
  | "CONFIDENCE"
  | "RISK"
  | "TIMING"
  | "EXIT"
  | "GENERAL";

export type DerivedLesson = {
  id: string;
  text: string;
  cycle: number;
  category: LessonCategory;
  confidence: number;
  evidenceCount: number;
  sourceExperienceIds: string[];
  createdAt: string;
};

export type LessonStats = {
  totalLessons: number;
  latestCycle: number;
  byCategory: Record<string, number>;
};

// ─── Learning Response ───────────────────────────────────────────────

export type LearningResponse = {
  experiences: AiExperience[];
  lessons: AiLesson[];
  timeline: AiTimelineEvent[];
  improvement: AiImprovementData[];
  // Phase 5: Trade experiences and derived lessons
  tradeExperiences?: TradeExperience[];
  experienceStats?: ExperienceStats;
  derivedLessons?: DerivedLesson[];
  lessonStats?: LessonStats;
};
