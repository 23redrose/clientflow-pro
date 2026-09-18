import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const id = () => randomBytes(16).toString("hex");
export const token = () => randomBytes(24).toString("base64url");
export const iso = (value = new Date()) => value.toISOString();
export function hashPassword(password) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
export function verifyPassword(password, stored) { const [salt, expected] = stored.split(":"); if (!salt || !expected) return false; const actual = scryptSync(password, salt, 64); const target = Buffer.from(expected, "hex"); return actual.length === target.length && timingSafeEqual(actual, target); }
export const hashSession = (raw) => createHash("sha256").update(raw).digest("hex");

function interpolate(template, data) { return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(data[key] ?? "")); }

export async function sendEmail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }) });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || `Resend ${response.status}`); return { id: result.id };
}

export async function sendSms({ to, text }) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET || !process.env.TWILIO_MESSAGING_SERVICE_SID || !to) return { skipped: true };
  const base = process.env.TWILIO_API_BASE || "https://api.twilio.com";
  const url = `${base}/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const body = new URLSearchParams({ To: to, MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, Body: text });
  const auth = Buffer.from(`${process.env.TWILIO_API_KEY}:${process.env.TWILIO_API_SECRET}`).toString("base64");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || `Twilio ${response.status}`); return { id: result.sid };
}

export async function dispatchReminder({ client, settings, kind, data }) {
  const template = kind === "appointment" ? settings.appointment_message : settings.invoice_message;
  const text = interpolate(template, { prenom: client.first_name, nom: client.last_name, entreprise: settings.business_name, ...data });
  const results = [];
  if (settings.email_enabled && client.email_opt_in && client.email) results.push({ channel: "email", destination: client.email, result: await sendEmail({ to: client.email, subject: kind === "appointment" ? `Confirmation de rendez-vous — ${settings.business_name}` : `Rappel de facture — ${settings.business_name}`, text }) });
  if (settings.sms_enabled && client.sms_opt_in && client.phone) results.push({ channel: "sms", destination: client.phone, result: await sendSms({ to: client.phone, text }) });
  return results;
}

export async function createStripeCheckout({ organization, userEmail }) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) throw new Error("Stripe n’est pas configuré");
  const suffix=randomBytes(6).toString("base64url").replace(/[^a-z]/gi,"").toLowerCase().slice(0,8).padEnd(8,"x");
  const body = new URLSearchParams({ mode: "subscription", "line_items[0][price]": process.env.STRIPE_PRICE_ID, "line_items[0][quantity]": "1", client_reference_id: organization.id, success_url: `${process.env.APP_URL}/?subscription=success`, cancel_url: `${process.env.APP_URL}/?subscription=cancelled`, "metadata[organization_id]": organization.id, integration_identifier:`clientflow_${suffix}` });
  const trialEnd=Math.floor(new Date(organization.trial_ends_at).getTime()/1000);
  if(organization.plan_status==="trialing"&&trialEnd>Math.floor(Date.now()/1000)+172800)body.set("subscription_data[trial_end]",String(trialEnd));
  if(organization.stripe_customer_id)body.set("customer",organization.stripe_customer_id);else body.set("customer_email",userEmail);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error?.message || `Stripe ${response.status}`); return result;
}

export async function createStripePortal({ organization }) {
  if (!process.env.STRIPE_SECRET_KEY || !organization.stripe_customer_id) throw new Error("Aucun abonnement Stripe actif");
  const body=new URLSearchParams({customer:organization.stripe_customer_id,return_url:`${process.env.APP_URL}/`});
  const response=await fetch("https://api.stripe.com/v1/billing_portal/sessions",{method:"POST",headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},body});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error?.message||`Stripe ${response.status}`);return result;
}

export function verifyStripeSignature(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET; if (!secret || !header) return false;
  const pairs = Object.fromEntries(header.split(",").map((part) => part.split("="))); const signed = `${pairs.t}.${rawBody}`; const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(pairs.v1 || ""); return a.length === b.length && timingSafeEqual(a, b);
}
