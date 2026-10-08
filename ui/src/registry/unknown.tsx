export function UnknownBody({ type }: { type: string }) {
  return (
    <p className="card-unknown" data-testid="unknown-type">
      Unsupported type <code>{type}</code>
    </p>
  );
}
