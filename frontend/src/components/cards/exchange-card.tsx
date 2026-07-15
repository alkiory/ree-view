import { Card, SectionLabel, ArrowLeftRight } from './primitives';
import { C } from '../../libs/design-tokens';
import { InternationalExchangesProps } from '../../types/frontera.type';

interface ExchangeCardProps {
  internationalExchanges: InternationalExchangesProps['internationalExchanges'];
  saldoTotal: number;
}

const COUNTRY_FLAGS: Readonly<Record<string, string>> = {
  Francia: '🇫🇷',
  Portugal: '🇵🇹',
  Marruecos: '🇲🇦',
  Andorra: '🇦🇩',
};

const fallbackFlag = '🏳️';

export default function ExchangeCard({
  internationalExchanges,
  saldoTotal,
}: ExchangeCardProps) {
  const entries = Object.entries(internationalExchanges).filter(
    ([key]) => key !== 'saldoInternacional',
  );

  const maxAbs = Math.max(
    0.1,
    ...entries.flatMap(([, v]) => [Math.abs(v.import), Math.abs(v.export)]),
  );

  return (
    <Card data-testid="exchange-card">
      <SectionLabel icon={ArrowLeftRight}>Intercambios internacionales</SectionLabel>
      <div className="p-5 flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: C.muted }}>
            Sin datos de intercambios internacionales en el rango seleccionado.
          </p>
        ) : (
          entries.map(([country, data]) => {
            const impW = (data.import / maxAbs) * 100;
            const expW = (Math.abs(data.export) / maxAbs) * 100;
            return (
              <div key={country} className="flex items-center gap-3">
                <span
                  className="w-[110px] text-[12.5px] flex items-center gap-1.5 shrink-0"
                  style={{ color: C.text }}
                >
                  <span aria-hidden>{COUNTRY_FLAGS[country] ?? fallbackFlag}</span> {country}
                </span>
                <div className="flex-1 flex items-center h-4">
                  {/* Import (izquierda, sentido positivo) */}
                  <div className="flex-1 flex justify-end">
                    <div
                      className="h-2.5 rounded-l-full"
                      style={{ width: `${impW}%`, background: C.live }}
                    />
                  </div>
                  {/* Eje separador central */}
                  <div className="w-px h-4" style={{ background: C.border }} />
                  {/* Export (derecha, invertido a positivo) */}
                  <div className="flex-1">
                    <div
                      className="h-2.5 rounded-r-full"
                      style={{ width: `${expW}%`, background: C.danger }}
                    />
                  </div>
                </div>
                <span
                  className="w-[110px] text-right text-[11.5px]"
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: C.muted,
                  }}
                >
                  +{data.import.toFixed(2)} / {data.export.toFixed(2)}
                </span>
              </div>
            );
          })
        )}
        <div
          className="flex items-center justify-between pt-3 mt-1 border-t"
          style={{ borderColor: C.border }}
        >
          <span className="text-[12px]" style={{ color: C.muted }}>
            Saldo internacional (GWh)
          </span>
          <span
            className="text-sm font-semibold"
            style={{
              color: saldoTotal < 0 ? C.danger : saldoTotal > 0 ? C.renewable : C.muted,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {saldoTotal.toFixed(3)}
          </span>
        </div>
      </div>
    </Card>
  );
}
