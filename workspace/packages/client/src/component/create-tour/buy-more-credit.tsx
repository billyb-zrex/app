import React, { useEffect, useRef, useState } from 'react';
import { LoadingOutlined, WalletFilled } from '@ant-design/icons';
import { ReqSubscriptionInfo, RespSubscription } from '@fable/common/dist/api-contract';
import api from '@fable/common/dist/api';
import raiseDeferredError from '@fable/common/dist/deferred-error';
import Button from '../button';
import { amplitudeBuyMoreQuillyCredit } from '../../amplitude';

declare const Chargebee: any;

function BuyMoreCredit({
  currentCredit,
  checkCredit,
  showCreditInfo,
  clickedFrom,
  title,
  showIcon
}:
{
  currentCredit: number;
  checkCredit: ()=> Promise<RespSubscription>,
  showCreditInfo: boolean,
  clickedFrom: 'header' | 'create-demo' | 'preview' | 'billing',
  title?: string,
  showIcon?: boolean
}): JSX.Element | null {
  const billingEnabled = process.env.REACT_APP_SELF_HOSTED_CORE !== 'true'
    && !!process.env.REACT_APP_CHARGEBEE_SITE;
  const [availableCredits, setAvailableCredits] = useState(0);
  const [isBuyMoreCreditInProcess, setIsBuyMoreCreditInProgress] = useState(false);
  const creditIntervalRef = useRef<null | NodeJS.Timeout>(null);

  const handleCreditUpdate = (): void => {
    if (!checkCredit) return;
    setIsBuyMoreCreditInProgress(true);
    creditIntervalRef.current = setInterval(() => {
      checkCredit();
    }, 2000);
  };

  useEffect(() => {
    if (availableCredits < currentCredit) {
      if (creditIntervalRef.current !== null) {
        clearInterval(creditIntervalRef.current);
        creditIntervalRef.current = null;
      }
      isBuyMoreCreditInProcess && amplitudeBuyMoreQuillyCredit(clickedFrom, currentCredit - availableCredits);
      setAvailableCredits(currentCredit);
      setIsBuyMoreCreditInProgress(false);
    }
  }, [currentCredit]);

  useEffect(() => {
    setAvailableCredits(currentCredit);
    if (!billingEnabled || typeof Chargebee === 'undefined') return;
    Chargebee.init({
      site: process.env.REACT_APP_CHARGEBEE_SITE,
    });

    return () => {
      if (creditIntervalRef.current !== null) {
        clearInterval(creditIntervalRef.current);
        creditIntervalRef.current = null;
      }
    };
  }, []);

  const buyMoreCredit = (): void => {
    if (!billingEnabled || typeof Chargebee === 'undefined') return;
    const cbInstance = Chargebee.getInstance();
    cbInstance.openCheckout({
      hostedPage() {
        return api<ReqSubscriptionInfo | undefined, null>('/credittopupurl', {
          method: 'POST',
          auth: true
        });
      },
      loaded() { },
      error(e: Error) { raiseDeferredError(e); },
      close() { },
      success() {
        handleCreditUpdate();
      },
      step() { }
    });
  };

  if (!billingEnabled) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
      }}
    >
      {showCreditInfo
      && (
      <div>
        <div>Your AI credit is not enough</div>
        <div style={{
          fontSize: '0.9rem',
        }}
        >
          Your current credit:&nbsp;
          <span style={{
            color: 'white',
            background: '#16023e',
            padding: '1px 6px',
            borderRadius: '6px'
          }}
          >
            {currentCredit} <WalletFilled />
          </span>
        </div>
      </div>
      )}
      <Button
        type="submit"
        style={{
          backgroundColor: '#fedf64',
          color: 'black',
        }}
        onClick={buyMoreCredit}
        disabled={isBuyMoreCreditInProcess}
        icon={isBuyMoreCreditInProcess ? <LoadingOutlined /> : showIcon ? <WalletFilled /> : null}
        iconPlacement={isBuyMoreCreditInProcess ? 'right' : 'left'}
      >
        {title || 'Buy more credit'}
      </Button>
    </div>
  );
}

export default BuyMoreCredit;
