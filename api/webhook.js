// v-repop-portal/api/webhook.js

import { buffer } from "micro";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Mets tes variables d'environnement dans Vercel ! (voir étape suivante)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
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

  // Paiement réussi (checkout) ou abonnement payé
  if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    if (email) {
      // Récupérer l'utilisateur par email dans Supabase
      const { data: user, error } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (user && user.id) {
        // Upsert (insert or update) l’abonnement actif
        await supabase
          .from("abonnements")
          .upsert([
            {
              user_id: user.id,
              abonnement_actif: true,
              date_debut: new Date().toISOString(),
              date_fin: null,
            },
          ]);
      }
    }
  }

  // Abonnement annulé côté Stripe
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customer = subscription.customer;
    // Ici il faut retrouver le user par customer Stripe et désactiver l’abonnement
    // À compléter selon ta logique (souvent tu gardes le customerId Stripe dans Supabase)
  }

  res.status(200).json({ received: true });
}
