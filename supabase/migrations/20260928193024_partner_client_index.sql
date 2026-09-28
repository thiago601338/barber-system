-- Cover the client FK when counting a customer's eligible offer uses.
create index partner_redemptions_client_idx
  on public.partner_redemptions (barbershop_id, client_id, offer_id);
