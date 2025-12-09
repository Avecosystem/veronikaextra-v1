// components/CreditsPage.tsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { CREDIT_PLANS } from '../constants';
import Button from './ui/Button';
import GlassCard from './ui/GlassCard';
import Loader from './ui/Loader';
import { backendApi } from '../services/backendApi';
import { ApiResponse, CreditPlan } from '../types';
import Input from './ui/Input'; // Need Input for Phone Number

const CreditsPage: React.FC = () => {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [availableCreditPlans, setAvailableCreditPlans] = useState<CreditPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<{ id: number; credits: number; price: number; usdValue: number; inrValue: number } | null>(null);
  const [globalNotice, setGlobalNotice] = useState<string>('');
  const [creditsPageNotice, setCreditsPageNotice] = useState<string>('');
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Payment State
  const [redirecting, setRedirecting] = useState<boolean>(false);
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [showPhoneInput, setShowPhoneInput] = useState<boolean>(false);

  const isIndianUser = user?.country === 'India';
  const currencySymbol = isIndianUser ? '₹' : '$';

  // Fetch notices and plans
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Notices
        const globalResponse = await backendApi.getGlobalNotice();
        if (globalResponse.success) setGlobalNotice(globalResponse.data);
        
        const creditsPageResponse = await backendApi.getCreditsPageNotice();
        if (creditsPageResponse.success) setCreditsPageNotice(creditsPageResponse.data);

        // Plans
        const plansResponse = await backendApi.getAvailableCreditPlans(); 
        if (plansResponse.success) {
          setAvailableCreditPlans(plansResponse.data);
        } else {
          setAvailableCreditPlans(CREDIT_PLANS);
        }
      } catch (err) {
        console.error('Error fetching data for CreditsPage:', err);
        setNoticeError('Failed to load page data.');
        setAvailableCreditPlans(CREDIT_PLANS);
      }
    };
    fetchData();
  }, []);

  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-160px)]">
        <Loader message="Loading user data..." />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-160px)]">
        <GlassCard className="p-8 text-center">
          <h2 className="text-2xl font-bold text-darkText dark:text-lightText mb-4">Access Denied</h2>
          <p className="text-gray-500 dark:text-gray-400">Please log in to view and manage your credits.</p>
        </GlassCard>
      </div>
    );
  }

  const getPlanPrice = (plan: CreditPlan) => {
    return isIndianUser ? plan.inrPrice : plan.usdPrice;
  };

  const handlePlanSelect = (plan: CreditPlan) => {
    const price = getPlanPrice(plan);
    setSelectedPlan({
      id: plan.id,
      credits: plan.credits,
      price: price,
      usdValue: plan.usdPrice,
      inrValue: plan.inrPrice,
    });
    setError(null);
    setShowPhoneInput(false); // Reset phone input
  };

  const initiateUpiPayment = async () => {
    if (!selectedPlan || !user) return;

    setRedirecting(true);
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        setError("Auth token missing.");
        setRedirecting(false);
        return;
    }

    // Return URL for Cashfree - Explicitly pointing to Profile Page
    // Note: Cashfree appends ?order_id={order_id} to this URL
    const origin = window.location.origin;
    const isHttps = origin.startsWith('https://');
    const devFallback = 'https://veronikaextra-image.onrender.com/';
    const baseUrl = (isHttps ? origin + window.location.pathname : devFallback);
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const returnUrl = `${cleanBaseUrl}#/profile`;

    try {
        const response = await backendApi.submitUpiPaymentIntent(
            token, 
            `${selectedPlan.credits} Credits`,
            selectedPlan.credits,
            selectedPlan.inrValue,
            '',
            returnUrl
        );

        if (response.success && response.data.paymentLink) {
            window.location.href = response.data.paymentLink;
        } else {
            setError(response.message || "Failed to start UPI payment.");
            setRedirecting(false);
        }

    } catch (e) {
        console.error(e);
        setError("Connection error.");
        setRedirecting(false);
    }
  };

  const handleUpiClick = () => {
      initiateUpiPayment();
  };

  const handleCryptoPayment = async () => {
    if (!selectedPlan || !user) {
      setError('Please select a credit plan.');
      return;
    }
    setError(null);
    setRedirecting(true);

    const token = localStorage.getItem('jwt_token');
    if (!token) {
      setError('Authentication token not found.');
      setRedirecting(false);
      return;
    }

    const amountInUSD = selectedPlan.usdValue;
    const orderId = `${user.id}-${selectedPlan.credits}-${Date.now()}`;
    
    // Construct return URL
    const origin2 = window.location.origin;
    const isHttps2 = origin2.startsWith('https://');
    const devFallback2 = 'https://veronikaextra-image.onrender.com/';
    const baseUrl2 = (isHttps2 ? origin2 + window.location.pathname : devFallback2);
    const cleanBaseUrl2 = baseUrl2.endsWith('/') ? baseUrl2 : baseUrl2 + '/';
    const returnUrl = `${cleanBaseUrl2}#/profile`;

    try {
      // Now calls the backend API route for speed
      const intentResponse = await backendApi.submitCryptoPaymentIntent(
        token,
        orderId,
        selectedPlan.credits,
        amountInUSD,
        returnUrl
      );

      if (intentResponse.success && intentResponse.data?.paymentUrl) {
          window.location.href = intentResponse.data.paymentUrl;
      } else {
          setError(intentResponse.message || 'Failed to initiate crypto payment.');
          setRedirecting(false);
      }
    } catch (err) {
      console.error('OXPAY payment initiation error:', err);
      setError('An unexpected error occurred while initiating crypto payment.');
      setRedirecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 lg:p-12 min-h-[calc(100vh-160px)] animate-fade-in">
      {/* Notices */}
      {(globalNotice || creditsPageNotice || noticeError) && (
        <div className="w-full max-w-4xl mb-8 space-y-4">
            {globalNotice && (
                <GlassCard className="p-4 text-center text-darkText dark:text-lightText bg-accent/20 border-accent/50">
                    <p className="font-semibold text-lg">{globalNotice}</p>
                </GlassCard>
            )}
            {creditsPageNotice && (
                <GlassCard className="p-4 text-center text-darkText dark:text-lightText bg-blue-500/20 border-blue-500/50">
                    <p className="font-semibold text-lg">{creditsPageNotice}</p>
                </GlassCard>
            )}
            {noticeError && (
                <GlassCard className="p-4 text-center text-red-500 bg-red-500/10 border-red-500/50">
                    <p className="font-semibold text-lg">{noticeError}</p>
                </GlassCard>
            )}
        </div>
      )}

      <GlassCard className="max-w-4xl w-full p-6 md:p-8 text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold text-darkText dark:text-lightText mb-4">
          Your Credits: {user.credits}
        </h1>
        <p className="text-lg text-gray-500 dark:text-gray-400 mb-8">
          Select a plan to purchase more credits.
        </p>

        {/* Credit Plans Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {availableCreditPlans.length > 0 ? (
            availableCreditPlans.map((plan) => (
              <motion.div
                key={plan.id}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
              >
                <GlassCard
                  className={`p-6 flex flex-col items-center cursor-pointer transition-all duration-300 h-full
                              ${selectedPlan?.id === plan.id ? 'border-accent ring-2 ring-accent bg-accent/10' : 'hover:border-accent/50'}`}
                  onClick={() => handlePlanSelect(plan)}
                >
                  <p className="text-4xl font-extrabold text-accent mb-2">{plan.credits}</p>
                  <p className="text-xl font-semibold text-darkText dark:text-lightText mb-4">Credits</p>
                  <p className="text-3xl font-bold text-gray-500 dark:text-gray-400">{currencySymbol}{getPlanPrice(plan).toFixed(2)}</p>
                </GlassCard>
              </motion.div>
            ))
          ) : (
            <div className="col-span-full">
              <Loader message="Loading credit plans..." />
            </div>
          )}
        </div>

        {/* Payment Buttons Section */}
        <AnimatePresence>
          {selectedPlan && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mt-8 border-t border-gray-700/30 dark:border-gray-300/30 pt-8"
            >
              <h2 className="text-2xl font-bold text-darkText dark:text-lightText mb-6">
                Choose Payment Method
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                 Total: <span className="font-bold text-darkText dark:text-lightText">₹{selectedPlan.inrValue.toFixed(2)}</span>
                 <span className="ml-2 text-sm text-gray-400 dark:text-gray-500">(≈ ${selectedPlan.usdValue.toFixed(2)})</span>
              </p>
              
              {error && <p className="text-red-500 mb-4">{error}</p>}
              {redirecting && <Loader message="Redirecting to Payment Gateway..." className="mb-4" />}

              {
                  <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-lg mx-auto">
                    <Button 
                        variant="primary" 
                        size="lg" 
                        onClick={handleUpiClick}
                        className="w-full"
                        disabled={redirecting}
                    >
                        Pay with UPI (Fast)
                    </Button>
                    
                    <Button 
                        variant="download" // Using download variant for visual distinction (Blue)
                        size="lg" 
                        onClick={handleCryptoPayment}
                        className="w-full"
                        loading={redirecting}
                    >
                        Pay with Crypto
                    </Button>
                  </div>
              }
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
};

export default CreditsPage;
