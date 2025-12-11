import { User, ApiResponse, PaymentRequest, CryptoPaymentTransaction, CreditPlan, ContactInfo, SocialLinks, LegalContent } from '../types';
import { IMAGE_COST } from '../constants';

const getBase = () => {
  const cfg = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_BASE_URL) || '';
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
  const isDev = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.DEV) || false;
  return cfg || (isDev ? 'http://localhost:3000' : origin);
};

const withAuth = (token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export const backendApi = {
  async register(name: string, email: string, password: string, country: string, deviceId: string): Promise<ApiResponse<User>> {
    const r = await fetch(`${getBase()}/api/register`, {
      method: 'POST',
      headers: withAuth(),
      body: JSON.stringify({ name, email, password, country, deviceId })
    });
    const data = await r.json();
    if (r.ok && data?.success) return data;
    return { success: false, message: data?.message || 'Signup failed.' };
  },

  async login(email: string, password: string): Promise<ApiResponse<User>> {
    const r = await fetch(`${getBase()}/api/login`, {
      method: 'POST',
      headers: withAuth(),
      body: JSON.stringify({ email, password })
    });
    const data = await r.json();
    if (r.ok && data?.success) return data;
    return { success: false, message: data?.message || 'Login failed.' };
  },

  async getProfile(token: string): Promise<ApiResponse<User>> {
    const r = await fetch(`${getBase()}/api/profile`, {
      method: 'GET',
      headers: withAuth(token)
    });
    const data = await r.json();
    if (r.ok && data?.success) return data;
    return { success: false, message: data?.message || 'Unauthorized.' };
  },

  async generateImage(token: string, prompt: string, numberOfImages: number = 1): Promise<ApiResponse<{ images: string[], newCredits: number }>> {
    const r = await fetch(`${getBase()}/api/generate`, {
      method: 'POST',
      headers: withAuth(token),
      body: JSON.stringify({ prompt, numberOfImages })
    });
    const ct = r.headers.get('content-type') || '';
    const json = ct.includes('application/json') ? await r.json() : { message: await r.text() };
    if (!r.ok || !json?.success) {
      return { success: false, message: json?.message || 'Failed to generate image.' };
    }
    const urls = Array.isArray(json.images) ? json.images.map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean) : [];
    return { success: true, data: { images: urls, newCredits: json.newCredits || 0 } };
  },

  async submitUpiPaymentIntent(token: string, plan: string, credits: number, amount: number, customerPhone: string, returnUrl: string): Promise<ApiResponse<{ message: string; paymentLink?: string }>> {
    const profile = await this.getProfile(token);
    if (!profile.success) return { success: false, message: 'Unauthorized.' };
    const orderId = `${profile.data.id}-${credits}-${Date.now()}`;
    const rec = await fetch(`${getBase()}/api/record-payment-intent`, {
      method: 'POST',
      headers: withAuth(token),
      body: JSON.stringify({ plan, credits, amount, orderId })
    });
    if (!rec.ok) {
      const jd = await rec.json().catch(() => ({}));
      return { success: false, message: jd?.message || 'Failed to record payment intent.' };
    }
    const phoneSafe = (customerPhone && customerPhone.trim()) || '9999999999';
    const pay = await fetch(`${getBase()}/api/cashfree`, {
      method: 'POST',
      headers: withAuth(token),
      body: JSON.stringify({ orderId, amount, customerPhone: phoneSafe, customerName: profile.data.name, customerEmail: profile.data.email, returnUrl })
    });
    const data = await pay.json().catch(() => ({}));
    if (pay.ok && data?.success) return { success: true, data: { message: 'Redirecting to UPI...', paymentLink: data.paymentLink } };
    return { success: false, message: data?.message || 'Payment initiation failed' };
  },

  async submitCryptoPaymentIntent(token: string, orderId: string, credits: number, amount: number, returnUrl: string): Promise<ApiResponse<{ message: string; paymentUrl?: string }>> {
    const profile = await this.getProfile(token);
    if (!profile.success) return { success: false, message: 'Unauthorized.' };
    const rec = await fetch(`${getBase()}/api/record-crypto-intent`, {
      method: 'POST',
      headers: withAuth(token),
      body: JSON.stringify({ orderId, credits, amount })
    });
    if (!rec.ok) {
      const jd = await rec.json().catch(() => ({}));
      return { success: false, message: jd?.message || 'Failed to record crypto intent.' };
    }
    const pay = await fetch(`${getBase()}/api/oxapay`, {
      method: 'POST',
      headers: withAuth(token),
      body: JSON.stringify({ amount: Number(amount.toFixed(2)), returnUrl, description: `Purchase ${credits} Credits - ${profile.data.name}`, orderId, email: profile.data.email })
    });
    const data = await pay.json().catch(() => ({}));
    if (pay.ok && data?.success) return { success: true, data: { message: 'Crypto payment intent recorded. Redirecting...', paymentUrl: data.paymentUrl } };
    return { success: false, message: data?.message || 'Failed to initiate crypto payment.' };
  },

  async verifyPaymentStatus(token: string, orderId: string, provider: 'OXPAY' | 'CASHFREE'): Promise<ApiResponse<{ newCredits: number }>> {
    if (provider === 'CASHFREE') {
      const r = await fetch(`${getBase()}/api/verify-payment`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ orderId }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.success && d.status === 'PAID') {
        const me = await this.getProfile(token);
        if (me.success) return { success: true, data: { newCredits: me.data.credits } };
        return { success: true, data: { newCredits: 0 } };
      }
      return { success: false, message: d?.message || 'Payment verification failed.' };
    }
    return { success: false, message: 'Crypto verification not supported.' };
  },

  async verifyOxapayPayment(token: string, orderId: string, status: string): Promise<ApiResponse<{ newCredits: number }>> {
    const r = await fetch(`${getBase()}/api/verify-oxapay`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ orderId, status }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.success) {
      const me = await this.getProfile(token);
      if (me.success) return { success: true, data: { newCredits: me.data.credits } };
      return { success: true, data: { newCredits: 0 } };
    }
    return { success: false, message: d?.message || 'Crypto payment verification failed.' };
  },

  async getAllUsers(token: string): Promise<ApiResponse<User[]>> {
    const r = await fetch(`${getBase()}/api/admin/users`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch users.' };
  },

  async updateUserCreditsAdmin(token: string, targetUserId: number, newCredits: number): Promise<ApiResponse<User>> {
    const r = await fetch(`${getBase()}/api/admin/update-credits`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ userId: targetUserId, newCredits }) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update credits.' };
  },

  async deleteUser(token: string, userIdToDelete: number): Promise<ApiResponse<{ message: string }>> {
    const r = await fetch(`${getBase()}/api/admin/users/${userIdToDelete}`, { method: 'DELETE', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to delete user.' };
  },

  async getAllPaymentRequests(token: string): Promise<ApiResponse<PaymentRequest[]>> {
    const r = await fetch(`${getBase()}/api/admin/payment-requests`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch payment requests.' };
  },

  async getAllCryptoPaymentTransactions(token: string): Promise<ApiResponse<CryptoPaymentTransaction[]>> {
    const r = await fetch(`${getBase()}/api/admin/crypto-transactions`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch crypto transactions.' };
  },

  async approvePaymentRequest(token: string, requestId: number): Promise<ApiResponse<{ message: string }>> {
    const r = await fetch(`${getBase()}/api/admin/payment-requests/${requestId}/approve`, { method: 'POST', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to approve request.' };
  },

  async rejectPaymentRequest(token: string, requestId: number): Promise<ApiResponse<{ message: string }>> {
    const r = await fetch(`${getBase()}/api/admin/payment-requests/${requestId}/reject`, { method: 'POST', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to reject request.' };
  },

  async getGlobalNotice(): Promise<ApiResponse<string>> {
    const r = await fetch(`${getBase()}/api/global-notice`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch notice.' };
  },

  async setGlobalNotice(token: string, message: string): Promise<ApiResponse<string>> {
    const r = await fetch(`${getBase()}/api/global-notice`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ message }) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update notice.' };
  },

  async getCreditsPageNotice(): Promise<ApiResponse<string>> {
    const r = await fetch(`${getBase()}/api/credits-notice`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch credits notice.' };
  },

  async setCreditsPageNotice(token: string, message: string): Promise<ApiResponse<string>> {
    const r = await fetch(`${getBase()}/api/credits-notice`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ message }) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update credits notice.' };
  },

  async getExchangeRate(): Promise<ApiResponse<number>> {
    const r = await fetch(`${getBase()}/api/exchange-rate`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch exchange rate.' };
  },

  async setExchangeRate(token: string, rate: number): Promise<ApiResponse<number>> {
    const r = await fetch(`${getBase()}/api/exchange-rate`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ rate }) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update exchange rate.' };
  },

  async getAvailableCreditPlans(): Promise<ApiResponse<CreditPlan[]>> {
    const r = await fetch(`${getBase()}/api/credit-plans`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch credit plans.' };
  },

  async getAdminCreditPlans(token: string): Promise<ApiResponse<CreditPlan[]>> {
    const r = await fetch(`${getBase()}/api/admin/credit-plans`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch admin credit plans.' };
  },

  async updateAdminCreditPlan(token: string, planId: number, updatedCredits: number, updatedInrPrice: number, updatedUsdPrice: number): Promise<ApiResponse<CreditPlan>> {
    const r = await fetch(`${getBase()}/api/admin/credit-plans/${planId}`, { method: 'POST', headers: withAuth(token), body: JSON.stringify({ credits: updatedCredits, inrPrice: updatedInrPrice, usdPrice: updatedUsdPrice }) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update credit plan.' };
  },

  async getUserPaymentRequests(token: string): Promise<ApiResponse<PaymentRequest[]>> {
    const r = await fetch(`${getBase()}/api/user/payment-requests`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch payment requests.' };
  },

  async getUserCryptoTransactions(token: string): Promise<ApiResponse<CryptoPaymentTransaction[]>> {
    const r = await fetch(`${getBase()}/api/user/crypto-transactions`, { method: 'GET', headers: withAuth(token) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch crypto transactions.' };
  },

  async getContactInfo(): Promise<ApiResponse<ContactInfo>> {
    const r = await fetch(`${getBase()}/api/contact-info`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch contact info.' };
  },

  async updateContactInfo(token: string, newInfo: ContactInfo): Promise<ApiResponse<ContactInfo>> {
    const r = await fetch(`${getBase()}/api/contact-info`, { method: 'POST', headers: withAuth(token), body: JSON.stringify(newInfo) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update contact info.' };
  },

  async getSocialLinks(): Promise<ApiResponse<SocialLinks>> {
    const r = await fetch(`${getBase()}/api/social-links`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch social links.' };
  },

  async updateSocialLinks(token: string, links: SocialLinks): Promise<ApiResponse<SocialLinks>> {
    const r = await fetch(`${getBase()}/api/social-links`, { method: 'POST', headers: withAuth(token), body: JSON.stringify(links) });
    const d = await r.json();
    if (r.ok && d?.success) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('socialLinksUpdated'));
      return d;
    }
    return { success: false, message: d?.message || 'Failed to update social links.' };
  },

  async getLegalContent(): Promise<ApiResponse<LegalContent>> {
    const r = await fetch(`${getBase()}/api/legal-content`, { method: 'GET', headers: withAuth() });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to fetch legal content.' };
  },

  async updateLegalContent(token: string, content: LegalContent): Promise<ApiResponse<LegalContent>> {
    const r = await fetch(`${getBase()}/api/legal-content`, { method: 'POST', headers: withAuth(token), body: JSON.stringify(content) });
    const d = await r.json();
    if (r.ok && d?.success) return d;
    return { success: false, message: d?.message || 'Failed to update legal content.' };
  },

  logout(token: string): void {
    fetch(`${getBase()}/api/logout`, { method: 'POST', headers: withAuth(token) }).catch(() => {});
  },
};
