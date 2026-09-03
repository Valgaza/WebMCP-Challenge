import { Info } from "lucide-react";
import type { ReactNode } from "react";

interface FieldHelpProps {
  /** The control this explains, for the trigger's own name: "What Saturation means". */
  subject: string;
  /** Referenced by the field's `aria-describedby`, so the description survives the collapse. */
  id?: string;
  children: ReactNode;
}

/**
 * A definition, kept but not always on screen.
 *
 * Estro explains photo jargon in ordinary words, which is the point of the product — but with
 * seven colour sliders each carrying a sentence underneath, the Inspector column was more
 * prose than control, and the explanation was in the way of the person who already knew what
 * saturation was.
 *
 * Nothing is deleted. The sentence moves beside its label, behind a mark you can hover, focus
 * or tap.
 *
 * It fades with `opacity` rather than `visibility` or `display` on purpose: the field points
 * at this text with `aria-describedby`, and a description a screen reader cannot reach is not
 * a description. So the text stays in the accessibility tree at every moment; only its paint
 * is conditional.
 */
export function FieldHelp({ subject, id, children }: FieldHelpProps) {
  return (
    <span className="field-help-host">
      <button className="field-help-trigger" type="button" aria-label={`What ${subject} means`}>
        <Info aria-hidden="true" size={12} />
      </button>
      <span className="field-help-bubble" id={id} role="tooltip">{children}</span>
    </span>
  );
}
