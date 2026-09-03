"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import dashboardJson from "./data/dashboard.json";
import modelJson from "./data/model.json";

type PredictionInput = {
  surface: number;
  pieces: number;
  chambres: number;
  balcon: 0 | 1;
  arrondissement: string;
  cuisine: string;
  type_bien: string;
};

type Distribution = {
  min: number;
  p05: number;
  p25: number;
  median: number;
  mean: number;
  p75: number;
  p95: number;
  max: number;
};

type ArrondissementStats = {
  arrondissement: number;
  label: string;
  count: number;
  price_eur: Distribution;
  surface_m2: Distribution;
  price_per_m2_eur: Distribution;
  balcony_share: number;
};

type SamplePoint = PredictionInput & {
  prix_eur: number;
  prix_m2_eur: number;
};

type DashboardPayload = {
  data_quality: {
    rows_raw: number;
    rows_unique_ads: number;
    duplicate_rows_removed: number;
    rows_used_for_model: number;
  };
  market_summary: {
    count: number;
    price_eur: Distribution;
    surface_m2: Distribution;
    price_per_m2_eur: Distribution;
    balcony_share: number;
  };
  model_evaluation: {
    gradient_boosting_oof: {
      mae_eur: number;
      mape: number;
      r2: number;
      within_20_percent: number;
    };
  };
  arrondissements: ArrondissementStats[];
  charts: {
    arrondissement_price_per_m2_ranking: Array<{
      arrondissement: number;
      label: string;
      count: number;
      median_price_per_m2_eur: number;
    }>;
  };
  sample_points: SamplePoint[];
  ui_options: {
    arrondissements: Array<{ value: string; label: string }>;
    cuisines: string[];
  };
};

type Tree = {
  children_left: number[];
  children_right: number[];
  feature: number[];
  threshold: number[];
  value: number[];
};

type ModelPayload = {
  preprocessing: {
    numeric_features: string[];
    categorical_features: Array<{ name: string; categories: string[] }>;
  };
  model: {
    learning_rate: number;
    init_prediction: number;
    trees: Tree[];
  };
  uncertainty: {
    default_level: string;
    levels: Record<string, { absolute_log_residual_quantile: number; multiplicative_factor: number }>;
  };
};

type Estimate = {
  input: PredictionInput;
  price: number;
  lower: number;
  upper: number;
};

const dashboard = dashboardJson as unknown as DashboardPayload;
const estimator = modelJson as unknown as ModelPayload;

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

const compactEuro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function roundTo(value: number, precision = 1_000) {
  return Math.round(value / precision) * precision;
}

function encodeInput(input: PredictionInput) {
  const values: number[] = [];
  for (const feature of estimator.preprocessing.numeric_features) {
    values.push(Math.fround(Number(input[feature as keyof PredictionInput])));
  }
  for (const feature of estimator.preprocessing.categorical_features) {
    const inputValue = String(input[feature.name as keyof PredictionInput]);
    for (const category of feature.categories) {
      values.push(Math.fround(inputValue === category ? 1 : 0));
    }
  }
  return values;
}

function scoreTree(tree: Tree, features: number[]) {
  let node = 0;
  while (tree.children_left[node] !== -1) {
    const feature = tree.feature[node];
    node = features[feature] <= tree.threshold[node]
      ? tree.children_left[node]
      : tree.children_right[node];
  }
  return tree.value[node];
}

function predict(input: PredictionInput): Estimate {
  const features = encodeInput(input);
  const treeSum = estimator.model.trees.reduce((sum, tree) => sum + scoreTree(tree, features), 0);
  const logPrice = estimator.model.init_prediction + estimator.model.learning_rate * treeSum;
  const quantile = estimator.uncertainty.levels[estimator.uncertainty.default_level].absolute_log_residual_quantile;
  return {
    input: { ...input },
    price: Math.exp(logPrice),
    lower: Math.exp(logPrice - quantile),
    upper: Math.exp(logPrice + quantile),
  };
}

function ScatterChart({
  points,
  estimate,
  label,
}: {
  points: SamplePoint[];
  estimate: Estimate | null;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointSummary = useMemo(() => {
    if (!points.length) return "Aucune annonce affichée.";
    const surfaces = points.map((point) => point.surface).sort((a, b) => a - b);
    const prices = points.map((point) => point.prix_eur).sort((a, b) => a - b);
    const middle = Math.floor(points.length / 2);
    return `${points.length} annonces affichées, surface médiane ${integer.format(surfaces[middle])} m² et prix médian ${compactEuro.format(prices[middle])}. La tendance est croissante avec la surface.`;
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = Math.max(300, canvas.clientWidth);
      const height = 340;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { left: 54, right: 18, top: 18, bottom: 38 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const allPoints = estimate
        ? [...points, { ...estimate.input, prix_eur: estimate.price, prix_m2_eur: estimate.price / estimate.input.surface }]
        : points;
      const maxSurface = Math.max(100, ...allPoints.map((point) => point.surface));
      const maxPrice = Math.max(1_000_000, ...allPoints.map((point) => point.prix_eur));
      const xMax = Math.ceil(maxSurface / 25) * 25;
      const yMax = Math.ceil(maxPrice / 250_000) * 250_000;
      const toX = (surface: number) => padding.left + (surface / xMax) * chartWidth;
      const toY = (price: number) => padding.top + chartHeight - (price / yMax) * chartHeight;

      context.strokeStyle = "#e2ded5";
      context.lineWidth = 1;
      context.fillStyle = "#7a817d";
      context.font = "11px Inter, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let step = 0; step <= 4; step += 1) {
        const price = (yMax / 4) * step;
        const y = toY(price);
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillText(step === 0 ? "0" : `${(price / 1_000_000).toFixed(1).replace(".0", "")} M€`, padding.left - 8, y);
      }

      context.textAlign = "center";
      context.textBaseline = "top";
      for (let step = 0; step <= 4; step += 1) {
        const surface = (xMax / 4) * step;
        context.fillText(`${Math.round(surface)} m²`, toX(surface), height - padding.bottom + 12);
      }

      if (points.length > 1) {
        const meanX = points.reduce((sum, point) => sum + point.surface, 0) / points.length;
        const meanY = points.reduce((sum, point) => sum + point.prix_eur, 0) / points.length;
        const numerator = points.reduce((sum, point) => sum + (point.surface - meanX) * (point.prix_eur - meanY), 0);
        const denominator = points.reduce((sum, point) => sum + (point.surface - meanX) ** 2, 0);
        const slope = denominator ? numerator / denominator : 0;
        const intercept = meanY - slope * meanX;
        context.save();
        context.strokeStyle = "rgba(31, 107, 90, .45)";
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(toX(0), toY(Math.max(0, intercept)));
        context.lineTo(toX(xMax), toY(Math.min(yMax, intercept + slope * xMax)));
        context.stroke();
        context.restore();
      }

      context.fillStyle = "rgba(31, 107, 90, .58)";
      for (const point of points) {
        context.beginPath();
        context.arc(toX(point.surface), toY(point.prix_eur), 3.2, 0, Math.PI * 2);
        context.fill();
      }

      if (estimate) {
        const x = toX(estimate.input.surface);
        const y = toY(estimate.price);
        context.fillStyle = "rgba(214, 162, 74, .22)";
        context.beginPath();
        context.arc(x, y, 11, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#d6a24a";
        context.beginPath();
        context.arc(x, y, 5.5, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#fffefb";
        context.lineWidth = 2;
        context.stroke();
      }
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [points, estimate]);

  return (
    <div className="scatter-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Nuage de points des prix observés selon la surface, ${label}`}
        aria-describedby="scatter-summary"
      />
      <p className="sr-only" id="scatter-summary">{pointSummary}</p>
      <div className="chart-legend">
        <span><i className="legend-dot observed" /> Annonces observées</span>
        {estimate && <span><i className="legend-dot estimated" /> Votre estimation</span>}
      </div>
    </div>
  );
}

export default function EstimatorApp() {
  const [input, setInput] = useState<PredictionInput>({
    arrondissement: "11",
    surface: 65,
    pieces: 3,
    chambres: 2,
    balcon: 0,
    cuisine: "inconnue",
    type_bien: "Appartement",
  });
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [dashboardArrondissement, setDashboardArrondissement] = useState<number | null>(11);

  const statsByArrondissement = useMemo(
    () => new Map(dashboard.arrondissements.map((item) => [item.arrondissement, item])),
    [],
  );
  const currentStats = statsByArrondissement.get(Number(input.arrondissement));
  const dashboardStats = dashboardArrondissement
    ? statsByArrondissement.get(dashboardArrondissement)
    : null;
  const dashboardLabel = dashboardStats?.label ?? "Tout Paris";
  const points = dashboard.sample_points.filter((point) => (
    dashboardArrondissement ? Number(point.arrondissement) === dashboardArrondissement : true
  ));
  const visibleEstimate = estimate && (
    dashboardArrondissement === null || Number(estimate.input.arrondissement) === dashboardArrondissement
  ) ? estimate : null;

  const formError = input.surface < 14 || input.surface > 250
    ? "La surface doit rester entre 14 et 250 m², plage couverte par le modèle."
    : input.chambres < 1 || input.chambres > 6
      ? "Le modèle couvre les biens comportant entre 1 et 6 chambres."
    : input.chambres > input.pieces
      ? "Le nombre de chambres ne peut pas dépasser le nombre de pièces."
      : "";

  const warnings = useMemo(() => {
    const messages: string[] = [];
    if (input.pieces === 1) messages.push("Couverture limitée pour les studios.");
    if ((currentStats?.count ?? 0) < 80) messages.push("Peu d'annonces disponibles dans cet arrondissement.");
    return messages;
  }, [input, currentStats]);

  function updateInput<K extends keyof PredictionInput>(key: K, value: PredictionInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
    setEstimate(null);
    if (key === "arrondissement") setDashboardArrondissement(Number(value));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (formError) return;
    const nextEstimate = predict(input);
    setEstimate(nextEstimate);
    setDashboardArrondissement(Number(input.arrondissement));
  }

  function chooseArrondissement(arrondissement: number) {
    updateInput("arrondissement", String(arrondissement));
  }

  const resultPricePerM2 = estimate ? estimate.price / estimate.input.surface : 0;
  const localPricePerM2 = currentStats?.price_per_m2_eur.median ?? dashboard.market_summary.price_per_m2_eur.median;
  const localDelta = estimate ? (resultPricePerM2 / localPricePerM2 - 1) * 100 : 0;
  const kpis = dashboardStats
    ? {
      count: dashboardStats.count,
      price: dashboardStats.price_eur.median,
      pricePerM2: dashboardStats.price_per_m2_eur.median,
      surface: dashboardStats.surface_m2.median,
    }
    : {
      count: dashboard.market_summary.count,
      price: dashboard.market_summary.price_eur.median,
      pricePerM2: dashboard.market_summary.price_per_m2_eur.median,
      surface: dashboard.market_summary.surface_m2.median,
    };

  return (
    <main>
      <header className="site-header shell">
        <a className="brand" href="#top" aria-label="Estima Paris, accueil">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>Estima Paris</span>
        </a>
        <a className="quiet-link" href="#marche">Comprendre les données</a>
      </header>

      <section className="hero shell" id="top">
        <div className="eyebrow"><span /> Estimateur immobilier parisien</div>
        <h1>Estimez un appartement<br />à Paris.</h1>
        <p className="hero-copy">
          Une fourchette claire, fondée sur {integer.format(dashboard.market_summary.count)} annonces parisiennes
          uniques, nettoyées et comparées arrondissement par arrondissement.
        </p>

        <div className="estimator-grid" id="estimateur">
          <form className="panel form-panel" onSubmit={submit}>
            <div className="panel-heading">
              <span className="step">01</span>
              <div><h2>Votre bien</h2><p>Quelques informations suffisent.</p></div>
            </div>

            <div className="fields-grid">
              <label>
                Arrondissement
                <select
                  value={input.arrondissement}
                  onChange={(event) => updateInput("arrondissement", event.target.value)}
                >
                  {dashboard.ui_options.arrondissements.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Surface habitable
                <div className="input-unit">
                  <input
                    type="number"
                    value={input.surface}
                    min="14"
                    max="250"
                    step="0.5"
                    aria-invalid={input.surface < 14 || input.surface > 250}
                    aria-describedby={formError || warnings.length ? "form-feedback" : undefined}
                    onChange={(event) => updateInput("surface", Number(event.target.value))}
                  />
                  <span>m²</span>
                </div>
              </label>
              <label>
                Nombre de pièces
                <input
                  type="number"
                  value={input.pieces}
                  min="1"
                  max="8"
                  aria-describedby={formError || warnings.length ? "form-feedback" : undefined}
                  onChange={(event) => updateInput("pieces", Number(event.target.value))}
                />
              </label>
              <label>
                Nombre de chambres
                <input
                  type="number"
                  value={input.chambres}
                  min="1"
                  max="6"
                  aria-invalid={input.chambres < 1 || input.chambres > 6 || input.chambres > input.pieces}
                  aria-describedby={formError || warnings.length ? "form-feedback" : undefined}
                  onChange={(event) => updateInput("chambres", Number(event.target.value))}
                />
              </label>
              <label>
                Cuisine
                <select value={input.cuisine} onChange={(event) => updateInput("cuisine", event.target.value)}>
                  {dashboard.ui_options.cuisines.map((cuisine) => (
                    <option key={cuisine} value={cuisine}>{cuisine.charAt(0).toUpperCase() + cuisine.slice(1)}</option>
                  ))}
                </select>
              </label>
              <fieldset className="balcony-field">
                <legend>Balcon</legend>
                <div className="segmented">
                  <button
                    className={input.balcon === 0 ? "active" : ""}
                    type="button"
                    aria-pressed={input.balcon === 0}
                    onClick={() => updateInput("balcon", 0)}
                  >Non</button>
                  <button
                    className={input.balcon === 1 ? "active" : ""}
                    type="button"
                    aria-pressed={input.balcon === 1}
                    onClick={() => updateInput("balcon", 1)}
                  >Oui</button>
                </div>
              </fieldset>
            </div>

            <div id="form-feedback" aria-live="polite">
              {formError && <p className="inline-error" role="alert">{formError}</p>}
              {!formError && warnings.length > 0 && <p className="inline-warning" role="status">{warnings.join(" ")}</p>}
            </div>
            <button className="primary-button" type="submit" disabled={Boolean(formError)}>
              {estimate ? "Recalculer l'estimation" : "Estimer mon bien"}<span aria-hidden="true">→</span>
            </button>
            <p className="form-note">Doublons et valeurs structurellement invalides exclus.</p>
          </form>

          <aside className={`panel result-panel ${estimate ? "has-result" : ""}`} aria-live="polite">
            <div className="panel-heading light">
              <span className="step">02</span>
              <div><h2>Votre estimation</h2><p>{"Prix d'annonce indicatif"}</p></div>
            </div>
            {estimate ? (
              <div className="result-content">
                <div className="coverage-badge"><span /> {warnings.length ? "Échantillon local limité" : "Échantillon local robuste"}</div>
                <p className="result-label">Estimation centrale</p>
                <strong className="result-price">{compactEuro.format(roundTo(estimate.price))}</strong>
                <div className="result-range">
                  <span>Fourchette à 90 %</span>
                  <strong>{compactEuro.format(roundTo(estimate.lower, 5_000))} — {compactEuro.format(roundTo(estimate.upper, 5_000))}</strong>
                </div>
                <div className="result-metrics">
                  <div><span>Prix estimé au m²</span><strong>{integer.format(roundTo(resultPricePerM2, 10))} €</strong></div>
                  <div><span>Médiane locale</span><strong>{integer.format(localPricePerM2)} €</strong></div>
                </div>
                <p className="local-comparison">
                  {localDelta >= 0 ? "+" : ""}{localDelta.toFixed(1).replace(".", ",")} % par rapport à la médiane au m² de {currentStats?.label}.
                </p>
                <p className="sample-note">{integer.format(currentStats?.count ?? 0)} annonces dédupliquées dans cet arrondissement.</p>
              </div>
            ) : (
              <div className="result-empty">
                <div className="result-orbit" aria-hidden="true"><span /></div>
                <h3>Prêt à estimer</h3>
                <p>{"Renseignez votre bien puis lancez l'estimation pour obtenir un prix et sa fourchette."}</p>
              </div>
            )}
            <div className="trust-line"><span /> Modèle calibré sur le marché parisien</div>
          </aside>
        </div>
      </section>

      <section className="market shell" id="marche">
        <div className="market-title-row">
          <div>
            <div className="eyebrow"><span /> Données dédupliquées</div>
            <h2>{"Le marché en un coup d'œil"}</h2>
            <p className="market-context">Vue actuelle : <strong>{dashboardLabel}</strong></p>
          </div>
          {dashboardArrondissement && (
            <button className="text-button" type="button" onClick={() => setDashboardArrondissement(null)}>Voir tout Paris</button>
          )}
        </div>

        <div className="kpi-row">
          <article><span>Annonces exploitables</span><strong>{integer.format(kpis.count)}</strong></article>
          <article><span>Prix médian</span><strong>{compactEuro.format(kpis.price)}</strong></article>
          <article><span>Prix médian au m²</span><strong>{integer.format(kpis.pricePerM2)} €</strong></article>
          <article><span>Surface médiane</span><strong>{integer.format(kpis.surface)} m²</strong></article>
        </div>

        <div className="charts-grid">
          <article className="chart-card bars-card">
            <div className="chart-heading">
              <div><span className="chart-kicker">Comparaison</span><h3>Prix médian au m²</h3></div>
              <span className="chart-unit">€ / m²</span>
            </div>
            <div className="bars-list">
              {dashboard.charts.arrondissement_price_per_m2_ranking.map((item) => {
                const maxValue = dashboard.charts.arrondissement_price_per_m2_ranking[0].median_price_per_m2_eur;
                const selected = dashboardArrondissement === item.arrondissement;
                const detail = statsByArrondissement.get(item.arrondissement);
                return (
                  <button
                    key={item.arrondissement}
                    type="button"
                    className={`bar-row ${selected ? "selected" : ""}`}
                    onClick={() => chooseArrondissement(item.arrondissement)}
                    aria-pressed={selected}
                    title={`${item.label} · ${integer.format(item.count)} annonces · Q1 ${integer.format(detail?.price_per_m2_eur.p25 ?? 0)} € · Q3 ${integer.format(detail?.price_per_m2_eur.p75 ?? 0)} €`}
                    aria-label={`Sélectionner ${item.label}, médiane ${integer.format(item.median_price_per_m2_eur)} euros par mètre carré`}
                  >
                    <span className="bar-label">{item.arrondissement === 1 ? "1er" : `${item.arrondissement}e`}</span>
                    <span className="bar-track"><i style={{ width: `${(item.median_price_per_m2_eur / maxValue) * 100}%` }} /></span>
                    <strong>{integer.format(item.median_price_per_m2_eur)}</strong>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="chart-card scatter-card">
            <div className="chart-heading">
              <div><span className="chart-kicker">Relation</span><h3>Prix observé selon la surface</h3></div>
              <span className="chart-unit">{dashboardLabel}</span>
            </div>
            <ScatterChart points={points} estimate={visibleEstimate} label={dashboardLabel} />
            <p className="chart-note">{"Échantillon visuel d'annonces dédupliquées. La ligne indique la tendance, pas une valeur garantie."}</p>
          </article>
        </div>

        <div className="method-strip">
          <div><span>Erreur moyenne observée</span><strong>{compactEuro.format(dashboard.model_evaluation.gradient_boosting_oof.mae_eur)}</strong></div>
          <div><span>Erreur relative moyenne</span><strong>{(dashboard.model_evaluation.gradient_boosting_oof.mape * 100).toFixed(1).replace(".", ",")} %</strong></div>
          <div><span>Estimations à ±20 %</span><strong>{(dashboard.model_evaluation.gradient_boosting_oof.within_20_percent * 100).toFixed(0)} %</strong></div>
          <p>Mesures hors échantillon, sans validation temporelle faute de date dans la source.</p>
        </div>
      </section>

      <footer className="footer shell">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">E</span><span>Estima Paris</span></div>
        <p>{"Cette estimation repose sur des prix d'annonces et ne remplace pas l'avis d'un professionnel. Les studios sont peu représentés."}</p>
        <a href="#top">Retour en haut ↑</a>
      </footer>
    </main>
  );
}
