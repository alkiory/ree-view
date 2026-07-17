import { Card, SectionLabel, ArrowLeftRight } from "./primitives";
import {
  C,
  COUNTRY_CODES,
  COUNTRY_COLORS,
  FALLBACK_COUNTRY_CODE,
  FALLBACK_COUNTRY_COLOR,
} from "../../libs/design-tokens";
import { InternationalExchangesProps } from "../../types/frontera.type";

interface ExchangeCardProps {
  internationalExchanges: InternationalExchangesProps["internationalExchanges"];
  saldoTotal: number;
}

export default function ExchangeCard({
  internationalExchanges,
  saldoTotal,
}: ExchangeCardProps) {
  const entries = Object.entries(internationalExchanges).filter(
    ([key]) => key !== "saldoInternacional",
  );

  const maxAbs = Math.max(
    0.1,
    ...entries.flatMap(([, v]) => [Math.abs(v.import), Math.abs(v.export)]),
  );

  return (
    <Card data-testid="exchange-card">
      <SectionLabel icon={ArrowLeftRight}>
        Intercambios internacionales
      </SectionLabel>
      <div className="p-5 flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: C.muted }}>
            Sin datos de intercambios internacionales en el rango seleccionado.
          </p>
        ) : (
          entries.map(([country, data]) => {
            const code = COUNTRY_CODES[country] ?? FALLBACK_COUNTRY_CODE;
            const color = COUNTRY_COLORS[country] ?? FALLBACK_COUNTRY_COLOR;
            const impW = (data.import / maxAbs) * 100;
            const expW = (Math.abs(data.export) / maxAbs) * 100;
            return (
              <div
                key={country}
                className="flex items-center gap-3"
                data-testid={`exchange-row-${code}`}
              >
                <span
                  className="w-[26px] h-[18px] rounded-[4px] flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: `${color}22`, color }}
                  aria-label={`Código ISO de ${country}`}
                  title={country}
                >
                  {code}
                </span>
                <span
                  className="w-[90px] text-[12.5px] shrink-0"
                  style={{ color: C.text }}
                >
                  {country}
                </span>
                <div
                  className="flex-1 h-2.5 rounded-full overflow-hidden flex"
                  style={{ background: C.surfaceAlt }}
                  role="group"
                  aria-label={`${country}: importación ${data.import.toFixed(2)}, exportación ${data.export.toFixed(2)}`}
                >
                  <div
                    style={{
                      width: `${impW}%`,
                      background: color,
                      opacity: 0.55,
                    }}
                    aria-label="Importación"
                  />
                  <div
                    style={{ width: `${expW}%`, background: color }}
                    aria-label="Exportación"
                  />
                </div>
                <span
                  className="w-[120px] text-right text-[11px]"
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
              color:
                saldoTotal < 0
                  ? C.danger
                  : saldoTotal > 0
                    ? C.renewable
                    : C.muted,
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
