export function modelRef(model) {
  const id = model.modelID ?? model.id
  const variant = model.variant ? `#${model.variant}` : ""
  return `${model.providerID}/${id}${variant}`
}

export function parseRef(ref) {
  const providerEnd = ref.indexOf("/")
  if (providerEnd <= 0) return undefined
  const variantStart = ref.indexOf("#", providerEnd + 1)
  const providerID = ref.slice(0, providerEnd)
  const id = ref.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : ref.slice(variantStart + 1)
  if (!id || !variant && variantStart !== -1) return undefined
  return { providerID, id, ...(variant ? { variant } : {}) }
}

// OpenCode's per-model `family` is tier-granular (deepseek-pro vs deepseek-flash,
// minimax-m-flash vs minimax-m). Collapse it to the vendor so two tiers of one
// vendor count as the same family while different vendors stay distinct. A model
// with no family field falls back to its provider prefix.
const FAMILY_TIER = /-(pro|flash|free|small|large|code|ultra|super|nano|lightning|spark|m)$/

export function vendorFamily(model) {
  const raw = model.family
  if (raw === undefined || raw === null || raw === "") return String(model.providerID)
  let family = String(raw)
  let previous
  do {
    previous = family
    family = family.replace(FAMILY_TIER, "")
  } while (family !== previous)
  return family || String(model.providerID)
}

export async function modelCatalog(ctx) {
  let result
  try {
    result = await ctx.model.list()
  } catch {
    return []
  }
  const models = Array.isArray(result) ? result : (result?.data ?? [])
  const seen = new Set()
  const catalog = []
  for (const model of models) {
    if ((model.type ?? "chat") !== "chat" || model.enabled === false) continue
    const ref = modelRef(model)
    if (seen.has(ref)) continue
    seen.add(ref)
    const cost = Array.isArray(model.cost) ? model.cost[0] : model.cost
    catalog.push({
      ref,
      name: model.name ?? ref,
      providerID: String(model.providerID),
      id: String(model.modelID ?? model.id),
      family: vendorFamily(model),
      status: model.status ?? "active",
      context: model.limit?.context ?? model.context,
      cost: cost ? { input: Number(cost.input ?? 0), output: Number(cost.output ?? 0) } : undefined,
      variants: (model.variants ?? []).map((variant) =>
        String(typeof variant === "string" ? variant : variant.id),
      ),
    })
  }
  return catalog
}

export async function currentModelRef(ctx, sessionID) {
  try {
    const result = await ctx.session.get({ sessionID })
    const model = result?.data?.model ?? result?.model
    return model ? modelRef(model) : undefined
  } catch {
    return undefined
  }
}

const formatNumber = (value) => (typeof value === "number" ? value.toLocaleString("en-US") : "?")

export function formatCatalog(catalog, currentRef) {
  if (!catalog.length) return ""
  const current = currentRef?.split("#")[0]
  const lines = catalog.map((entry) => {
    const marks = []
    if (entry.ref === current) marks.push("current")
    if (entry.status !== "active") marks.push(entry.status)
    const context = entry.context ? `context ${formatNumber(entry.context)}` : "context ?"
    const cost = entry.cost ? `$${entry.cost.input}/$${entry.cost.output} per Mtok` : "cost ?"
    const variants = entry.variants.length ? `variants: ${entry.variants.join(", ")}` : "no variants"
    const family = entry.family ? `family ${entry.family}` : "family ?"
    const suffix = marks.length ? ` [${marks.join(", ")}]` : ""
    return `- ${entry.ref} (${entry.name})${suffix} · ${family} · ${context} · ${cost} · ${variants}`
  })
  return [
    "<pstack_model_catalog>",
    "These are the real models configured in this OpenCode instance. Use only these refs when writing the sheet.",
    ...lines,
    "</pstack_model_catalog>",
  ].join("\n")
}
