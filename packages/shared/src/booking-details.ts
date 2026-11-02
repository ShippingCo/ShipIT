/** Optional structured facts captured at the courier counter, frozen with each parcel. */
export interface BookingParcelDetails {
  country: 'IN'; postal_code: string; city: string; region: string;
  contents_type: 'solid' | 'documents' | 'liquid' | 'semi_liquid' | 'other';
  contents_description: string; liquid_quantity_ml: number | null;
}
