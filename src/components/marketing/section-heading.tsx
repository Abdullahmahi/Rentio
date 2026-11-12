import { Container } from "@/components/marketing/ui/container";

/** The heading every marketing section opens with: lead, italic emphasis, subhead. */
export function SectionHeading({
  eyebrow,
  lead,
  emphasis,
  subhead,
}: {
  eyebrow?: string | undefined;
  lead: string;
  emphasis: string;
  subhead?: string | undefined;
}) {
  return (
    <Container>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        {eyebrow ? (
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-balance font-heading text-2xl font-medium !leading-snug md:text-4xl lg:text-5xl">
          {lead} <span className="font-subheading italic">{emphasis}</span>
        </h2>
        {subhead ? (
          <p className="mt-5 text-balance text-base text-muted-foreground md:text-lg">{subhead}</p>
        ) : null}
      </div>
    </Container>
  );
}
