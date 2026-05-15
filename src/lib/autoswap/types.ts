// Types partagés pour le module AutoSwap.
// Ces types décrivent la forme des données après normalisation depuis la réponse brute ZRExpress.

export interface ZRParcel {
  id: string;
  trackingNumber: string;
  externalId?: string;
  amount?: number;
  returnPrice?: number;
  deliveryPrice?: number;
  productsDescription?: string;
  isReturn?: boolean;
  type?: string;
  customer?: {
    customerId?: string;
    name?: string;
    phone?: { number1?: string; number2?: string; number3?: string };
  };
  deliveryAddress?: {
    street?: string;
    city?: string;
    cityTerritoryId?: string;
    cityTerritoryCode?: number;
    district?: string;
    districtTerritoryId?: string;
  };
  state?: { id?: string; name?: string; description?: string };
  swap?: {
    count?: number;
    sameCityCount?: number;
    differentCityCount?: number;
    swappedAt?: string | null;
    sameCityPrice?: number;
    differentCityPrice?: number;
    isEligibleForSwap?: boolean;
  };
}

export interface NormalizedParcel {
  id: string;
  trackingNumber: string;
  externalId: string;
  // Produit
  productVariantId: string | null;   // UUID extrait de productsDescription
  productSkuCode: string | null;     // ex "ayl" parsé depuis "( ayl )"
  productName: string;
  variantColor: string | null;
  variantSize: string | null;
  rawDescription: string;
  // Géographie
  cityTerritoryId: string;
  wilayaCode: number;
  cityName: string;
  district: string;
  // Client / montants
  customerName: string;
  customerPhone: string;
  amount: number;
  returnPrice: number;
  deliveryPrice: number;
  // Statut
  stateName: string;
  // Eligibilité swap (uniquement pertinent côté source)
  swap: {
    isEligibleForSwap: boolean;
    swappedAt: string | null;
    sameCityPrice: number;
    differentCityPrice: number;
    count: number;
  };
}

export type Confidence = 'EXACT' | 'STRONG' | 'WEAK';

export interface MatchProposal {
  swappable: {
    id: string;
    tracking: string;
    customer: string;
    wilaya: string;
    city: string;
    product: string;
    variantColor: string | null;
    variantSize: string | null;
    amount: number;
  };
  target: {
    id: string;
    tracking: string;
    customer: string;
    customerPhone: string;
    wilaya: string;
    city: string;
    product: string;
    variantColor: string | null;
    variantSize: string | null;
    amount: number;
  };
  confidence: Confidence;
  score: number;
  same_city: boolean;
  same_wilaya: boolean;
  estimated_savings: number;
  warnings: string[];
}

export interface PreviewResponse {
  proposals: MatchProposal[];
  stats: {
    total_parcels: number;
    total_swappable: number;
    total_targets: number;
    matches_count: number;
    total_savings: number;
    by_confidence: { EXACT: number; STRONG: number; WEAK: number };
  };
}

export interface ExecutionResult {
  source_tracking: string;
  target_tracking: string;
  status: 'success' | 'failed';
  error?: string;
  zr_response?: unknown;
}

export interface ExecuteResponse {
  executed: number;
  failed: number;
  results: ExecutionResult[];
}
