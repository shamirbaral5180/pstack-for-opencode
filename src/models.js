export function modelRef(model) {
  const id = model.modelID ?? model.id
  const variant = model.variant ? `#${model.variant}` : ""
  return `${model.providerID}/${id}${variant}`
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
    catalog.push({
      ref,
      name: model.name ?? ref,
      providerID: String(model.providerID),
      id: String(model.modelID ?? model.id),
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

export function formatCatalog(catalog) {
  if (!catalog.length) return ""
  const lines = catalog.map((entry) => {
    const variants = entry.variants.length ? ` variants: ${entry.variants.join(", ")}` : ""
    return `- ${entry.ref} (${entry.name})${variants}`
  })
  return [
    "<pstack_model_catalog>",
    "These are the real models configured in this OpenCode instance. Use only these refs when writing the sheet.",
    ...lines,
    "</pstack_model_catalog>",
  ].join("\n")
}
