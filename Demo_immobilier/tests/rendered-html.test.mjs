import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Estima Paris application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Estima Paris/);
  assert.match(html, /Estimez un appartement/);
  assert.match(html, /Votre bien/);
  assert.match(html, /Le marché en un coup d/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/i);
});

test("browser scorer matches the exported model contract", async () => {
  const [model, dashboard] = await Promise.all([
    readFile(new URL("app/data/model.json", projectRoot), "utf8").then(JSON.parse),
    readFile(new URL("app/data/dashboard.json", projectRoot), "utf8").then(JSON.parse),
  ]);

  function encode(input) {
    const values = [];
    for (const feature of model.preprocessing.numeric_features) {
      values.push(Math.fround(Number(input[feature])));
    }
    for (const feature of model.preprocessing.categorical_features) {
      for (const category of feature.categories) {
        values.push(Math.fround(String(input[feature.name]) === category ? 1 : 0));
      }
    }
    return values;
  }

  function treeScore(tree, features) {
    let node = 0;
    while (tree.children_left[node] !== -1) {
      node = features[tree.feature[node]] <= tree.threshold[node]
        ? tree.children_left[node]
        : tree.children_right[node];
    }
    return tree.value[node];
  }

  function predict(input) {
    const features = encode(input);
    const sum = model.model.trees.reduce(
      (total, tree) => total + treeScore(tree, features),
      0,
    );
    return Math.exp(model.model.init_prediction + model.model.learning_rate * sum);
  }

  const errors = model.test_vectors.map((vector) => (
    Math.abs(predict(vector.input) - vector.expected_price_eur)
  ));

  assert.ok(Math.max(...errors) < 0.00001);
  assert.equal(dashboard.market_summary.count, 3644);
  assert.deepEqual(dashboard.market_summary.property_type_distribution, { Appartement: 3644 });
  assert.equal(model.scope.training_rows, dashboard.market_summary.count);
  assert.equal(dashboard.data_quality.duplicate_rows_removed, 5084);
});
