// v-repop-portal/api/webhook.js

import { buffer } from "micro";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: false } };

// ⚠️ Remplace par tes vrais price_id Stripe !
const priceIdToPlan = {
  "price_1RPV7FQwQkCLRX5vwTZMnpc5": { formule: "Starter", quota_max: 500 },
  "price_1RSwSbQwQkCLRX5vg0xWnlnr":   { formule: "Elite", quota_max: 2500 },
  "price_1RSwT4QwQkCLRX5vWlGiGAbI":     { formule: "VIP", quota_max: 5000 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Gère abonnement payé/renouvelé
  if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
    const session = event.data.object;

    // 1. Récupérer le price_id et l’email
    const priceId = session?.metadata?.price_id || session?.display_items?.[0]?.price?.id || session?.lines?.data?.[0]?.price?.id || session?.plan?.id || session?.subscription?.plan?.id || session?.items?.[0]?.price?.id;
    const email = session.customer_email || session.customer_details?.email;

    if (email && priceId) {
      // 2. On trouve l'user dans Supabase via son email
      const { data: user, error } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (user && user.id) {
        const plan = priceIdToPlan[priceId];
        if (plan) {
          // 3. On met à jour l’abonnement : formule, quota_max, quota_utilise = 0, actif
          await supabase
            .from("abonnements")
            .upsert([{
              user_id: user.id,
              abonnement_actif: true,
              formule: plan.formule,
              quota_max: plan.quota_max,
              quota_utilise: 0,
              date_debut: new Date().toISOString(),
              date_fin: null // Optionnel : à gérer si tu veux des fins d'abos
            }]);
        }
      }
    }
  }

  // Gère résiliation (désactive abonnement)
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customer = subscription.customer;

    // À adapter selon comment tu fais le mapping client Stripe <> Supabase
    // Idéalement tu utilises customer_email/metadata dans Stripe
    // Ou tu stockes stripe_customer_id dans Supabase
    // Ici à compléter si tu veux la désactivation auto
  }

  res.status(200).json({ received: true });
}
