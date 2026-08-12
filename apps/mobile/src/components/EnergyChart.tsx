import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export type EnergyPoint = { at: string; value: number };

/**
 * Consommation par intervalle (écran 2.2).
 *
 * **Des colonnes, pas une courbe.** Chaque valeur est un total consommé sur un
 * intervalle clos, pas un relevé instantané : une ligne inventerait une
 * progression continue entre deux points, là où il n'y a que deux totaux.
 *
 * **Une seule série, donc pas de légende** — le titre de la carte dit déjà ce qui
 * est tracé, et un cartouche à une pastille ne ferait que le répéter.
 *
 * **Ambre, comme toute la consommation dans l'application.** C'est le rôle
 * `energy` du thème, pas une couleur choisie pour ce graphique : la teinte porte
 * ici un sens produit, la même que le pourcentage et le total de l'écran.
 *
 * Le libellé de valeur ne s'affiche que sur le maximum, et sur la colonne
 * touchée : une valeur au-dessus de chaque colonne ne se lit plus.
 */
export function EnergyChart({
  points,
  unit = 'kWh',
  height = 160,
  formatLabel,
}: {
  points: EnergyPoint[];
  unit?: string;
  height?: number;
  /** Libellé d'axe pour un point — l'appelant sait s'il s'agit d'heures ou de jours. */
  formatLabel: (at: string, index: number, total: number) => string | null;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const max = Math.max(...points.map((p) => p.value), 0);
  const peak = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -1) ? i : best), 0);

  // Réserve haute pour le libellé de valeur, basse pour l'axe des temps.
  const plotTop = 22;
  const plotBottom = height - 18;
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const slot = points.length > 0 ? width / points.length : 0;
  // Le gap de 2 px sépare deux colonnes voisines ; la largeur est plafonnée pour
  // que la place restante du créneau devienne de l'air, pas de la matière.
  const barWidth = Math.max(2, Math.min(24, slot - 2));

  const selected = touched !== null ? points[touched] : null;

  return (
    <View onLayout={onLayout} style={{ gap: space.sm }}>
      {width > 0 && points.length > 0 && (
        <View>
          <Svg width={width} height={height}>
            {/* Ligne de base seule : une grille complète pour sept colonnes
                ajouterait de l'encre sans rien porter. */}
            <Line
              x1={0}
              y1={plotBottom}
              x2={width}
              y2={plotBottom}
              stroke={t.lineStrong}
              strokeWidth={1}
            />

            {points.map((point, index) => {
              const ratio = max > 0 ? point.value / max : 0;
              const barHeight = Math.max(ratio > 0 ? 2 : 0, ratio * plotHeight);
              const x = index * slot + (slot - barWidth) / 2;
              const y = plotBottom - barHeight;
              const active = touched === index;

              if (barHeight === 0) return null;

              // Sommet arrondi à 4 px, pied carré sur la ligne de base : le rayon
              // est réduit quand la colonne est plus basse que lui, sinon la forme
              // se déforme en pastille.
              const r = Math.min(4, barHeight, barWidth / 2);
              return (
                <Path
                  key={point.at}
                  d={`M${x},${plotBottom} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barWidth - r},${y} Q${x + barWidth},${y} ${x + barWidth},${y + r} L${x + barWidth},${plotBottom} Z`}
                  fill={t.energy}
                  opacity={touched === null || active ? 1 : 0.45}
                />
              );
            })}

            {/* Zones tactiles : un créneau entier par colonne, pour ne pas exiger
                de viser une barre de quelques pixels. */}
          </Svg>

          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height, flexDirection: 'row' }}>
            {points.map((point, index) => (
              <Pressable
                key={point.at}
                onPress={() => setTouched(touched === index ? null : index)}
                accessibilityRole="button"
                accessibilityLabel={`${formatLabel(point.at, index, points.length) ?? ''} : ${format(point.value)} ${unit}`}
                style={{ flex: 1 }}
              />
            ))}
          </View>

          {/* Valeur du maximum, ou de la colonne touchée. Le texte porte un ton de
              texte, jamais la couleur de la série. */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' }}>
            <Txt variant="micro" tone={selected ? 'primary' : 'secondary'}>
              {selected
                ? `${labelOf(selected, formatLabel, points)} · ${format(selected.value)} ${unit}`
                : max > 0
                  ? `max ${format(max)} ${unit}`
                  : ''}
            </Txt>
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row' }}>
        {points.map((point, index) => {
          const label = formatLabel(point.at, index, points.length);
          return (
            <View key={point.at} style={{ flex: 1, alignItems: 'center' }}>
              {label && (
                <Txt variant="micro" tone="muted">
                  {label}
                </Txt>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Vide plutôt qu'un graphique à zéro : une surface plate se lit comme une panne. */
export function EnergyChartEmpty({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: 120,
        borderRadius: radius.control,
        backgroundColor: t.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.md,
      }}
    >
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
    </View>
  );
}

function labelOf(
  point: EnergyPoint,
  formatLabel: (at: string, index: number, total: number) => string | null,
  points: EnergyPoint[],
): string {
  const index = points.indexOf(point);
  return formatLabel(point.at, index, points.length) ?? '';
}

/** Trois décimales comme ailleurs dans l'application : en kWh, l'ordre est petit. */
function format(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
