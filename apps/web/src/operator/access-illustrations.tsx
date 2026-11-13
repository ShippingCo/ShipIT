/**
 * The three scenes on the sign-in panel, drawn rather than photographed.
 *
 * Stock photography said "a parcel exists". It said nothing about this software. These say
 * what ShippingCo does, in the order it does it: a docket is written at the counter, a load
 * moves along a route, a handover is proved at the door. They are the brand mark at scale —
 * the same stacked-parcel geometry as the logo, built from the same few shapes.
 *
 * Inline SVG, deliberately: this app builds to one inlined HTML file, so a drawing that costs
 * two kilobytes of markup beats any raster, scales to any panel height, and takes its colours
 * from the panel instead of needing a second asset for a dark surface.
 *
 * Each scene is drawn on no ground of its own — the panel behind it is the ground — so there
 * is no frame inside a frame. Depth comes from three flat faces in isometric projection and
 * one soft contact shadow; there are no gradients and no glows. The palette is four values:
 * two blues, a lit face, and the single amber that marks what is happening right now.
 */
const DEEP = '#16375c';   // the shaded face, a shade above the panel
const BODY = '#2f67b0';   // the solid mass of a thing
const LIGHT = '#c4daf5';  // the lit face
const MARK = '#f0c073';   // the one accent: the live detail
const PAPER = '#f4f7fb';  // a docket, a receipt

/** 01 — Booking. A parcel on the counter scale, with its docket written beside it. */
export function CounterScene() {
  return <svg viewBox="0 0 320 220" role="img" className="access-scene"
    aria-label="A parcel on the counter scale beside its docket">
    <ellipse cx="150" cy="178" rx="104" ry="17" fill={DEEP} opacity=".55"/>
    {/* the counter top, in projection */}
    <path d="M46 168 150 142l104 26-104 26Z" fill={DEEP}/>
    <path d="M46 168v9l104 26v-9Z" fill="#102c4c"/>
    <path d="M254 168v9l-104 26v-9Z" fill={BODY} opacity=".4"/>
    {/* the weighing platform */}
    <path d="M94 156 150 142l56 14-56 14Z" fill={BODY} opacity=".55"/>
    <path d="M94 156v6l56 14v-6Z" fill="#102c4c"/>
    <path d="M206 156v6l-56 14v-6Z" fill={BODY}/>
    {/* the parcel: three faces, one box */}
    <path d="M104 118 150 106l46 12-46 12Z" fill={LIGHT}/>
    <path d="M104 118v30l46 12v-30Z" fill={BODY}/>
    <path d="M196 118v30l-46 12v-30Z" fill={DEEP}/>
    {/* the tie, where a parcel is actually tied */}
    <path d="M150 106v54" stroke={MARK} strokeWidth="2.4" opacity=".95"/>
    <path d="M104 118l46 12 46-12" stroke={MARK} strokeWidth="2.4" fill="none" opacity=".95"/>
    {/* the docket, with its number ruled in */}
    <rect x="212" y="74" width="68" height="58" rx="4" fill={PAPER}/>
    <path d="M222 90h48M222 101h48M222 112h31" stroke={BODY} strokeWidth="3" strokeLinecap="round"/>
    <path d="M261 112h11" stroke={MARK} strokeWidth="4" strokeLinecap="round"/>
  </svg>;
}

/** 02 — Dispatch. The load on a route, between the branch behind and the stop ahead. */
export function DispatchScene() {
  return <svg viewBox="0 0 320 220" role="img" className="access-scene"
    aria-label="A loaded vehicle moving along a route between branches">
    <ellipse cx="160" cy="176" rx="104" ry="16" fill={DEEP} opacity=".55"/>
    {/* the route: travelled solid, remaining dotted */}
    <path d="M22 172h58c32 0 24-54 58-54h62" stroke={LIGHT} strokeWidth="2.4" fill="none" opacity=".3" strokeDasharray="3 6"/>
    <path d="M22 172h58c32 0 24-54 58-54" stroke={LIGHT} strokeWidth="2.4" fill="none" opacity=".8"/>
    <circle cx="22" cy="172" r="5" fill={LIGHT} opacity=".8"/>
    <circle cx="276" cy="118" r="6.5" fill={MARK}/>
    {/* the vehicle, in the same projection as the parcel */}
    <path d="M100 98h80v52h-80Z" fill={BODY}/>
    <path d="M100 98l26-14h80l-26 14Z" fill={LIGHT}/>
    <path d="M180 98l26-14v52l-26 14Z" fill={DEEP}/>
    <path d="M180 116h28l16 18v16h-44Z" fill={BODY} opacity=".9"/>
    <path d="M185 121h20l10 12h-30Z" fill={LIGHT} opacity=".65"/>
    <circle cx="124" cy="154" r="12" fill="#102c4c"/><circle cx="124" cy="154" r="5" fill={LIGHT} opacity=".85"/>
    <circle cx="202" cy="154" r="12" fill="#102c4c"/><circle cx="202" cy="154" r="5" fill={LIGHT} opacity=".85"/>
    {/* the load it is carrying, stacked and counted */}
    <rect x="114" y="106" width="24" height="14" rx="2" fill={LIGHT} opacity=".9"/>
    <rect x="142" y="106" width="24" height="14" rx="2" fill={LIGHT} opacity=".55"/>
    <rect x="114" y="124" width="24" height="14" rx="2" fill={LIGHT} opacity=".55"/>
    <rect x="142" y="124" width="24" height="14" rx="2" fill={MARK} opacity=".92"/>
  </svg>;
}

/** 03 — Delivery. The handover at the door, and the proof that it happened. */
export function HandoverScene() {
  return <svg viewBox="0 0 320 220" role="img" className="access-scene"
    aria-label="A parcel handed over at a door, with proof of delivery recorded">
    <ellipse cx="168" cy="178" rx="100" ry="16" fill={DEEP} opacity=".5"/>
    {/* the doorway */}
    <path d="M44 48h86v124H44Z" fill={DEEP}/>
    <rect x="56" y="60" width="62" height="112" fill="#102c4c"/>
    <rect x="56" y="60" width="62" height="112" fill="none" stroke={LIGHT} strokeWidth="1.8" opacity=".45"/>
    <circle cx="106" cy="118" r="3.6" fill={MARK}/>
    {/* two hands meeting under the parcel: the handover itself */}
    <path d="M132 146c11-7 20-7 31-2" stroke={LIGHT} strokeWidth="6.5" strokeLinecap="round" fill="none" opacity=".9"/>
    <path d="M228 146c-11-7-20-7-31-2" stroke={LIGHT} strokeWidth="6.5" strokeLinecap="round" fill="none" opacity=".9"/>
    {/* the parcel, at the moment it changes hands */}
    <path d="M146 112 180 102l34 10-34 10Z" fill={LIGHT}/>
    <path d="M146 112v24l34 10v-24Z" fill={BODY}/>
    <path d="M214 112v24l-34 10v-24Z" fill={DEEP}/>
    <path d="M180 102v44" stroke={MARK} strokeWidth="2.4" opacity=".95"/>
    {/* the proof: a receipt with a tick, not a promise */}
    <rect x="236" y="58" width="56" height="66" rx="4" fill={PAPER}/>
    <path d="M246 74h36M246 85h36M246 96h21" stroke={BODY} strokeWidth="3" strokeLinecap="round"/>
    <circle cx="266" cy="112" r="11.5" fill={MARK}/>
    <path d="m261 112 4 4 7-8.5" stroke="#16375c" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>;
}
