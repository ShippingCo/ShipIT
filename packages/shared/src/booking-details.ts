/** Recipient contact is independent of the required booking customer identity. */
export interface BookingRecipientSnapshot {
  name: string | null;
  phone_normalized: string | null;
  phone_display: string | null;
  address: string;
}

/** Optional structured facts captured at the courier counter, frozen with each parcel. */
export interface BookingParcelDetails {
  country: 'IN'; postal_code: string; city: string; region: string;
  contents_type: 'solid' | 'documents' | 'liquid' | 'semi_liquid' | 'other';
  declared_value_paise?: number;
  contents_description: string; liquid_quantity_ml: number | null;
}
