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
  deliveryType?: string;
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
    postalCode?: string;
    country?: string;
    coordinates?: { lat?: number; lng?: number };
    hubId?: string;
    hubName?: string;
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

// Payload de swap conforme au schéma ZRExpress interne :
// POST /api/v1.0/parcel-modification-requests/swap
// Découvert via /swagger/internal-v1/swagger.json (CreateSwapParcelModificationRequestRequest)
export interface SwapRequestPayload {
  parcelId: string;                 // UUID du colis SOURCE (celui qu'on redirige)
  amount?: number | null;
  phone?: { number1?: string; number2?: string; number3?: string };
  deliveryType?: string | null;
  deliveryAddress?: {
    street?: string | null;
    city?: string | null;
    cityTerritoryId: string;
    district?: string | null;
    districtTerritoryId: string;
    postalCode?: string | null;
    country?: string | null;
    coordinates?: { lat?: number; lng?: number };
  };
  hubId?: string | null;
  newCustomerName?: string | null;
  newCustomerId?: string | null;
}

export interface NormalizedParcel {
  id: string;
  trackingNumber: string;
  externalId: string;
  // Produit
  productVariantId: string | null;   // UUID extrait de productsDescription
  productSkuCode: string | null;     // ex "ayl" parsé depuis "( ayl )"
  productName: string;
  productNameFingerprint: string;    // nom normalisé (sans couleurs/tailles) — sert quand SKU manque
  variantColors: string[];           // canoniques (ex ['noir', 'beige']) — multi-variants possibles
  variantSizes: string[];            // canoniques (ex ['M', 'XL', '42'])
  rawDescription: string;
  // Géographie
  cityTerritoryId: string;
  wilayaCode: number;
  cityName: string;
  district: string;
  // Client / montants
  customerName: string;
  customerId: string | null;
  customerPhone: string;
  customerPhones: { number1?: string; number2?: string; number3?: string };
  amount: number;
  returnPrice: number;
  deliveryPrice: number;
  // Adresse complète (pour construire le payload de swap)
  fullAddress: {
    street: string | null;
    city: string | null;
    cityTerritoryId: string;
    district: string | null;
    districtTerritoryId: string;
    postalCode: string | null;
    country: string | null;
    coordinates?: { lat?: number; lng?: number };
  };
  hubId: string | null;
  deliveryType: string | null;
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
    id: string;          // UUID — utilisé comme parcelId dans le payload de swap
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
    // Données complètes nécessaires pour construire le payload de swap.
    // Pas affichées dans l'UI ; sérialisées dans la requête /execute.
    swapPayload: {
      phone: { number1?: string; number2?: string; number3?: string };
      deliveryType: string | null;
      deliveryAddress: {
        street: string | null;
        city: string | null;
        cityTerritoryId: string;
        district: string | null;
        districtTerritoryId: string;
        postalCode: string | null;
        country: string | null;
        coordinates?: { lat?: number; lng?: number };
      };
      hubId: string | null;
      customerId: string | null;
    };
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
