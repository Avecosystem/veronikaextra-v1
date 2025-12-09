
// components/ProfilePage.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { backendApi } from '../services/backendApi';
import { ApiResponse } from '../types';
import GlassCard from './ui/GlassCard';
import Button from './ui/Button';
import Loader from './ui/Loader';

const ProfilePage: React.FC = () => {
  const { user, isAuthenticated, loading: authLoading, updateUserCredits } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const handleReturn = async () => {
      // Parse query parameters from URL
      const searchParams = new URLSearchParams(location.search);
      
      // OXPAY Params
      const oxapayStatus = searchParams.get('status') || searchParams.get('pay_status'); 
      const oxapayOrderId = searchParams.get('order_id') || searchParams.get('trackId');

      // CASHFREE Params
      const cashfreeOrderId = searchParams.get('order_id'); // Cashfree sends order_id

      let provider: 'OXPAY' | 'CASHFREE' | null = null;
      let orderIdToVerify = null;

      // Determine provider
      if (cashfreeOrderId && !oxapayStatus) {
          provider = 'CASHFREE';
          orderIdToVerify = cashfreeOrderId;
      } else if (oxapayOrderId) {
          provider = 'OXPAY';
          orderIdToVerify = oxapayOrderId;
      }

      if (provider && orderIdToVerify && !verifyingPayment) {
        setVerifyingPayment(true);
        setVerificationMessage(null);

        const token = localStorage.getItem('jwt_token');
        if (!token) {
          setVerificationMessage({ type: 'error', text: 'Authentication token not found.' });
          setVerifyingPayment(false);
          return;
        }

        try {
          // If Oxapay is waiting, return early
          if (provider === 'OXPAY' && oxapayStatus === 'waiting') {
             setVerificationMessage({ type: 'error', text: 'Payment is still processing. Please check back later.' });
             setVerifyingPayment(false);
             return;
          }

          const response: ApiResponse<{ newCredits: number }> = await backendApi.verifyPaymentStatus(
            token, 
            orderIdToVerify, 
            provider
          );
          
          if (response.success) {
            setVerificationMessage({ type: 'success', text: `Payment successful! Your new balance is ${response.data.newCredits} credits.` });
            updateUserCredits(response.data.newCredits);
          } else {
            setVerificationMessage({ type: 'error', text: `Payment verification: ${response.message || 'Pending or Failed.'}` });
          }
        } catch (err) {
          console.error('Error verifying payment:', err);
          setVerificationMessage({ type: 'error', text: 'An unexpected error occurred during payment verification.' });
        } finally {
          setVerifyingPayment(false);
        }
      }
    };

    if (isAuthenticated && user) {
        handleReturn();
    }
  }, [isAuthenticated, user, location.search, updateUserCredits]); 


  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-160px)]">
        <Loader message="Loading user profile..." />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-160px)]">
        <GlassCard className="p-8 text-center">
          <h2 className="text-2xl font-bold text-darkText dark:text-lightText mb-4">Access Denied</h2>
          <p className="text-gray-500 dark:text-gray-400">Please log in to view your profile.</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 lg:p-12 min-h-[calc(100vh-160px)]">
      {/* Payment Verification Overlay */}
      <AnimatePresence>
        {(verifyingPayment || verificationMessage) && (
          <motion.div
             initial={{ opacity: 0, y: -20 }}
             animate={{ opacity: 1, y: 0 }}
             exit={{ opacity: 0, y: -20 }}
             className="w-full max-w-xl mb-6"
          >
             {verifyingPayment && (
                 <GlassCard className="p-4 text-center flex items-center justify-center bg-blue-500/20 border-blue-500/50">
                     <Loader size="sm" color="text-blue-500" className="mr-3" />
                     <p className="text-blue-500 font-semibold">Verifying your payment...</p>
                 </GlassCard>
             )}
             {verificationMessage && !verifyingPayment && (
                 <GlassCard className={`p-4 text-center flex items-center justify-center ${verificationMessage.type === 'success' ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
                     <p className={`font-semibold ${verificationMessage.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                         {verificationMessage.text}
                     </p>
                     <button 
                        onClick={() => setVerificationMessage(null)} 
                        className="ml-4 text-sm underline hover:no-underline opacity-70 hover:opacity-100"
                     >
                        Dismiss
                     </button>
                 </GlassCard>
             )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-xl w-full"
      >
        <GlassCard className="p-6 md:p-8 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold text-darkText dark:text-lightText mb-4">
            Welcome, {user.name}!
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 mb-8">
            This is your personal profile page.
          </p>

          <div className="space-y-4 mb-8 text-left inline-block">
            <div className="flex items-center text-darkText dark:text-lightText">
              <svg className="h-6 w-6 text-accent mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-lg font-medium">Name: {user.name}</span>
            </div>
            <div className="flex items-center text-darkText dark:text-lightText">
              <svg className="h-6 w-6 text-accent mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              <span className="text-lg font-medium">Email: {user.email}</span>
            </div>
            {user.country && (
              <div className="flex items-center text-darkText dark:text-lightText">
                {/* Globe icon for country */}
                <svg className="h-6 w-6 text-accent mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2h7m-9 0v-1a2 2 0 002-2h7m-7 2h4m-4 0v2m7 0v-2M5 9.776V7.15c0-1.42 1.25-2.5 2.65-2.5h8.7C17.75 4.65 19 5.73 19 7.15v2.626M3 13.84V17a2 2 0 002 2h14a2 2 0 002-2v-3.16M16.5 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>
                <span className="text-lg font-medium">Country: {user.country}</span>
              </div>
            )}
            <div className="flex items-center text-darkText dark:text-lightText">
              <svg className="h-6 w-6 text-yellow-400 mr-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.459 4.218A9.993 9.006 0 0110 18a9.994 9.994 0 01-5.541-1.782l-.894.894a1 1 0 11-1.414-1.414l.894-.894A8 8 0 1014.541 15.782l.894.894a1 1 0 01-1.414 1.414l-.894-.894zM7 6a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm-.707 3.293a1 1 0 00-1.414 0l-1 1a1 1 0 101.414 1.414l1-1a1 1 0 000-1.414zM16 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zm-1.707-.293a1 1 0 00-1.414-1.414l-1 1a1 1 0 101.414 1.414l1-1z"></path></svg>
              <span className="text-lg font-medium">Credits: {user.credits}</span>
            </div>
          </div>

          <div className="flex flex-col space-y-4 max-w-sm mx-auto">
            <Button variant="primary" size="lg" onClick={() => navigate('/generator')}>
              Go to Generator
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/credits')}>
              Buy More Credits
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
};

export default ProfilePage;
