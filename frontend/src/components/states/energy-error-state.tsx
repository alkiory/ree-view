interface EnergyErrorStateProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  refetch: () => void;
}

export default function EnergyErrorState({ error, refetch }: EnergyErrorStateProps) {
  return (
    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4">
      <pre>Error (Energy): {error.message}</pre>
      {/* Wrap onClick en arrow explícita (no `onClick={refetch}`) — React
          pasa el SyntheticEvent como primer argumento y Apollo lo
          interpretaría como `variables` del refetch → canonicalStringify
          del MouseEvent → cycle React fiber → DOM element → Uncaught
          TypeError: Converting circular structure to JSON. */}
      <button
        onClick={() => refetch()}
        className="mt-2 bg-red-600 text-white py-1 px-3 rounded text-sm"
      >
        Retry Energy Data
      </button>
    </div>
  );
};