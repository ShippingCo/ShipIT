import type {BookingServiceDto} from '@shippingco/shared';
import {object,text,uuid,choice,integer,instant,array,page} from './dto';
export const bookingServiceDto=object({id:uuid,name:text,accepts_liquids:choice(true,false),service:choice('standard','express','same_city'),destination_key:text,pricing:object({kind:choice('flat','per_kg'),first_kg_paise:integer(),additional_kg_paise:integer(),packing_paise:integer()}),created_at:instant});
export const bookingServicesDto=object({items:array(bookingServiceDto,200),page});
export type BookingServiceOption=BookingServiceDto;
