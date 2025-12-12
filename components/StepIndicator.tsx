
import React from 'react';
import { AppStep } from '../types';
import { LayoutDashboard, FileCheck } from 'lucide-react';

interface Props {
  currentStep: AppStep;
  onStepChange: (step: AppStep) => void;
  canProceed: boolean;
}

export const StepIndicator: React.FC<Props> = ({ currentStep, onStepChange, canProceed }) => {
  const steps = [
    { id: AppStep.DASHBOARD, label: 'Reconciliation Dashboard', icon: LayoutDashboard },
    { id: AppStep.EXPORT_PREVIEW, label: 'Review & Export', icon: FileCheck },
  ];

  return (
    <div className="w-full max-w-3xl mx-auto mb-8">
      <div className="flex items-center justify-center gap-4">
        {steps.map((step, index) => {
          const isActive = currentStep === step.id;
          const isDisabled = step.id === AppStep.EXPORT_PREVIEW && !canProceed;

          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => !isDisabled && onStepChange(step.id)}
                disabled={isDisabled}
                className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-200 ${
                  isActive 
                    ? 'bg-brand-600 text-white shadow-md' 
                    : isDisabled 
                      ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                }`}
              >
                <step.icon size={18} />
                <span className="font-medium text-sm">{step.label}</span>
              </button>
              {index < steps.length - 1 && (
                <div className="w-8 h-0.5 bg-gray-200 dark:bg-slate-700" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
