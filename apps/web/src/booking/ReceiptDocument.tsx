import {renderReceiptView,type ReceiptView} from '../utils/receipt';

/**
 * The receipt on screen.
 *
 * This is not a web rendering of a receipt that happens to have a print stylesheet beside it.
 * It is the printed artefact, injected: the same function builds the markup here and builds
 * the sheet that goes to the printer, so there is exactly one document and no way for the two
 * to drift. Every value inside it was escaped by that renderer, and nothing in it is a link or
 * a control — a tax document has no actions on it.
 */
export function ReceiptDocument({view,label}:{view:ReceiptView;label?:string}) {
  return <div className="receipt-document" role="document" aria-label={label??('Receipt '+view.number)}
    dangerouslySetInnerHTML={{__html:renderReceiptView(view)}}/>;
}
