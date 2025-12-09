// components/admin/AdminCreditPlansPage.tsx
import React, { useEffect, useState, useCallback } from 'react';
import AdminDashboardLayout from './AdminDashboardLayout';
import GlassCard from '../ui/GlassCard';
import Loader from '../ui/Loader';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { backendApi } from '../../services/backendApi';
import { CreditPlan, ApiResponse } from '../../types';
import { FIXED_USD_TO_INR_RATE } from '../../constants';

const AdminCreditPlansPage: React.FC = () => {
  const { isAuthenticated, user: authUser, loading: authLoading } = useAuth();
  const [creditPlans, setCreditPlans] = useState<CreditPlan[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);
  const [currentEdit, setCurrentEdit] = useState<Omit<CreditPlan, 'id'> | null>(null);
  const [editLoading, setEditLoading] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState<number>(FIXED_USD_TO_INR_RATE);
  const [rateLoading, setRateLoading] = useState<boolean>(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSuccess, setRateSuccess] = useState<string | null>(null);

  const fetchCreditPlans = useCallback(async () => {
    if (!isAuthenticated || !authUser?.isAdmin) {
      setLoading(false);
      setError('Unauthorized access.');
      return;
    }

    setLoading(true);
    setError(null);
    const token = localStorage.getItem('jwt_token');
    if (!token) {
      setError('Authentication token not found.');
      setLoading(false);
      return;
    }

    try {
      const [plansRes, rateRes] = await Promise.all([
        backendApi.getAdminCreditPlans(token),
        backendApi.getExchangeRate()
      ]);

      if (plansRes.success) {
        setCreditPlans(plansRes.data);
      } else {
        setError(plansRes.message);
      }

      if (rateRes.success) {
        setExchangeRate(rateRes.data);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, authUser]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && authUser?.isAdmin) {
      fetchCreditPlans();
    }
  }, [authLoading, isAuthenticated, authUser, fetchCreditPlans]);

  const handleEdit = (plan: CreditPlan) => {
    setEditingPlanId(plan.id);
    setCurrentEdit({ credits: plan.credits, inrPrice: plan.inrPrice, usdPrice: plan.usdPrice });
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingPlanId(null);
    setCurrentEdit(null);
    setEditError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, field: keyof Omit<CreditPlan, 'id'>) => {
    if (!currentEdit) return;

    let value = parseFloat(e.target.value);
    if (isNaN(value)) {
      setCurrentEdit({ ...currentEdit, [field]: '' as any }); // Allow empty string for temporary invalid state
      return;
    }
    if (value < 0) value = 0; // Prevent negative values

    const newEdit = { ...currentEdit, [field]: value };

    // Auto-conversion logic
    if (field === 'inrPrice') {
      newEdit.usdPrice = parseFloat((value / exchangeRate).toFixed(2));
    } else if (field === 'usdPrice' && !e.target.dataset.manualEdit) { // Only auto-update if not a manual USD edit
      // No auto-update INR from USD for simplicity based on prompt, but leave option
    }

    setCurrentEdit(newEdit);
  };

  const handleSave = async (planId: number) => {
    if (!currentEdit) return;

    if (currentEdit.credits <= 0 || currentEdit.inrPrice <= 0 || currentEdit.usdPrice <= 0) {
      setEditError('Credits and prices must be positive numbers.');
      return;
    }

    setEditLoading(true);
    setEditError(null);
    const token = localStorage.getItem('jwt_token');
    if (!token) {
      setEditError('Authentication token not found.');
      setEditLoading(false);
      return;
    }

    try {
      const response: ApiResponse<CreditPlan> = await backendApi.updateAdminCreditPlan(
        token,
        planId,
        currentEdit.credits,
        currentEdit.inrPrice,
        currentEdit.usdPrice
      );
      if (response.success) {
        setCreditPlans(prevPlans => prevPlans.map(p => p.id === planId ? response.data : p));
        setEditingPlanId(null);
        setCurrentEdit(null);
      } else {
        setEditError(response.message);
      }
    } catch (err) {
      console.error('Error updating credit plan:', err);
      setEditError('Failed to update credit plan.');
    } finally {
      setEditLoading(false);
    }
  };

  const handleRateSave = async () => {
    setRateLoading(true);
    setRateError(null);
    setRateSuccess(null);
    const token = localStorage.getItem('jwt_token');
    if (!token) return;

    try {
      const response = await backendApi.setExchangeRate(token, exchangeRate);
      if (response.success) {
        setRateSuccess('Exchange rate updated.');
        setExchangeRate(response.data);
      } else {
        setRateError(response.message || 'Failed to update rate.');
      }
    } catch (e) {
      setRateError('Error updating rate.');
    } finally {
      setRateLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <AdminDashboardLayout title="Credit Plans Management">
        <Loader message="Loading credit plans..." className="py-10" />
      </AdminDashboardLayout>
    );
  }

  if (error) {
    return (
      <AdminDashboardLayout title="Credit Plans Management">
        <p className="text-red-500 text-center py-10">{error}</p>
      </AdminDashboardLayout>
    );
  }

  return (
    <AdminDashboardLayout title="Credit Plans Management">
      <div className="mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-2">Exchange Rate Settings</h3>
        <div className="flex items-end gap-4">
          <Input
            id="exchange-rate"
            label="USD to INR Rate"
            type="number"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(parseFloat(e.target.value))}
            className="w-40"
          />
          <Button onClick={handleRateSave} loading={rateLoading}>Update Rate</Button>
        </div>
        {rateError && <p className="text-red-500 text-sm mt-2">{rateError}</p>}
        {rateSuccess && <p className="text-green-500 text-sm mt-2">{rateSuccess}</p>}
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-2">
          This rate is used to auto-calculate USD prices when INR input is changed below. 1 USD = {exchangeRate} INR.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700 dark:divide-gray-300">
          <thead>
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Credits
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                INR Price
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                USD Price
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 dark:divide-gray-200">
            {creditPlans.map((plan) => (
              <tr key={plan.id} className="text-darkText dark:text-lightText hover:bg-gray-800/20 dark:hover:bg-gray-200/20 transition-colors duration-150">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {editingPlanId === plan.id ? (
                    <Input
                      id={`credits-${plan.id}`}
                      type="number"
                      value={currentEdit?.credits ?? ''}
                      onChange={(e) => handleInputChange(e, 'credits')}
                      className="w-24 text-sm py-1"
                      disabled={editLoading}
                    />
                  ) : (
                    plan.credits
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {editingPlanId === plan.id ? (
                    <Input
                      id={`inr-price-${plan.id}`}
                      type="number"
                      step="0.01"
                      value={currentEdit?.inrPrice ?? ''}
                      onChange={(e) => handleInputChange(e, 'inrPrice')}
                      className="w-24 text-sm py-1"
                      disabled={editLoading}
                    />
                  ) : (
                    `₹${plan.inrPrice.toFixed(2)}`
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {editingPlanId === plan.id ? (
                    <Input
                      id={`usd-price-${plan.id}`}
                      type="number"
                      step="0.01"
                      value={currentEdit?.usdPrice ?? ''}
                      onChange={(e) => {
                        // Mark as manual edit to prevent INR from overriding
                        e.target.dataset.manualEdit = 'true';
                        handleInputChange(e, 'usdPrice');
                      }}
                      onBlur={(e) => {
                        // Clear manual edit flag on blur
                        delete e.target.dataset.manualEdit;
                      }}
                      className="w-24 text-sm py-1"
                      disabled={editLoading}
                    />
                  ) : (
                    `$${plan.usdPrice.toFixed(2)}`
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {editingPlanId === plan.id ? (
                    <div className="flex items-center space-x-2">
                      <Button size="sm" onClick={() => handleSave(plan.id)} loading={editLoading}>Save</Button>
                      <Button variant="secondary" size="sm" onClick={handleCancelEdit} disabled={editLoading}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleEdit(plan)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editError && <p className="text-red-500 text-sm mt-4 text-center">{editError}</p>}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminCreditPlansPage;