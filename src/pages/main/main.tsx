// @ts-nocheck
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router';

import ChunkLoader from '@/components/loader/chunk-loader';
import { generateOAuthURL } from '@/components/shared';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradeTypeConfirmationModal from '@/components/trade-type-confirmation-modal';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
    disableUrlParameterApplication,
    enableUrlParameterApplication,
    setupTradeTypeChangeListener,
} from '@/utils/blockly-url-param-handler';
import {
    checkAndShowTradeTypeModal,
    getModalState,
    handleTradeTypeCancel,
    handleTradeTypeConfirm,
    resetUrlParamProcessing,
    setModalStateChangeCallback,
} from '@/utils/trade-type-modal-handler';
import {
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionBoldIcon,
} from '@deriv/quill-icons/LabelPaired';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';

import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
import './main.scss';

const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));

const NAV_ITEMS = [
    { hash: 'dashboard', id: 'id-dbot-dashboard', label: 'Dashboard' },
    { hash: 'bot_builder', id: 'id-bot-builder', label: 'Bot Builder' },
    { hash: 'free_bots', id: 'id-free-bots', label: 'Free Bots' },
    { hash: 'manual_trading', id: 'id-manual-trading', label: 'Manual Trading' },
    { hash: 'chart', id: 'id-charts', label: 'Charts' },
    { hash: 'bulk_trade', id: 'id-bulk-trade', label: 'Bulk Trade' },
    { hash: 'copy_trading', id: 'id-copy-trading', label: 'Copy Trading' },
] as const;

const NAV_HASHES = NAV_ITEMS.map(item => item.hash);

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card, blockly_store } = useStore();
    const { is_loading } = blockly_store;

    const {
        active_tab,
        active_tour,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
        setWebSocketState,
        setActiveTour,
        setTourDialogVisibility,
    } = dashboard;

    const { dashboard_strategies } = load_modal;
    const {
        is_dialog_open,
        dialog_options,
        onCancelButtonClick,
        onCloseDialog,
        onOkButtonClick,
        stopBot,
    } = run_panel;
    const { is_open } = quick_strategy;
    const { cancel_button_text, ok_button_text, title, message, dismissable, is_closed_on_cancel } =
        dialog_options as { [key: string]: string };
    const { clear } = summary_card;
    const { DASHBOARD, BOT_BUILDER } = DBOT_TABS;

    const location = useLocation();
    const navigate = useNavigate();
    const { isDesktop } = useDevice();
    const init_render = useRef(true);

    const [tradeTypeModalState, setTradeTypeModalState] = useState(getModalState());

    const is_preview_mode = window.location.pathname.includes('/preview');

    const getTabFromHash = useCallback(
        (fallback: number) => {
            const value = location.hash.replace(/^#/, '');
            if (!value) return is_preview_mode ? BOT_BUILDER : fallback;

            const index = NAV_HASHES.indexOf(value as (typeof NAV_HASHES)[number]);
            return index >= 0 ? index : is_preview_mode ? BOT_BUILDER : fallback;
        },
        [BOT_BUILDER, is_preview_mode, location.hash]
    );

    const activeHashTab = getTabFromHash(active_tab);

    const handleTabChange = useCallback(
        (index: number) => {
            if (index < 0 || index >= NAV_ITEMS.length) return;

            setActiveTab(index);

            const elementId = TAB_IDS[index] || NAV_ITEMS[index].id;
            const element = document.getElementById(elementId);

            window.setTimeout(() => {
                element?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center',
                });
            }, 10);
        },
        [setActiveTab]
    );

    useEffect(() => {
        setModalStateChangeCallback(setTradeTypeModalState);
        return () => setModalStateChangeCallback(() => {});
    }, []);

    useEffect(() => {
        resetUrlParamProcessing();
    }, [location.search]);

    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) return;

        const botIsRunning = document.getElementById('db-animation__stop-button') !== null;
        if (!botIsRunning) return;

        clear();
        stopBot();
        api_base.setIsRunning(false);
        setWebSocketState(false);
    }, [clear, connectionStatus, setWebSocketState, stopBot]);

    useEffect(() => {
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let modalTimer: ReturnType<typeof setTimeout> | undefined;
        let frameId: number | undefined;

        if (active_tab !== BOT_BUILDER) {
            return undefined;
        }

        frameId = window.requestAnimationFrame(() => {
            disableUrlParameterApplication();
            setupTradeTypeChangeListener();

            const showTradeTypeModal = () => {
                checkAndShowTradeTypeModal(
                    () => enableUrlParameterApplication(),
                    () => {}
                );
            };

            if (!blockly_store.is_loading) {
                modalTimer = window.setTimeout(showTradeTypeModal, 500);
                return;
            }

            let attempts = 0;
            const maxAttempts = 10;

            const waitForBlockly = () => {
                if (!blockly_store.is_loading) {
                    showTradeTypeModal();
                    return;
                }

                if (attempts >= maxAttempts) {
                    console.warn('Blockly loading timeout; continuing without URL trade-type processing.');
                    return;
                }

                attempts += 1;
                pollTimer = window.setTimeout(waitForBlockly, 500);
            };

            waitForBlockly();
        });

        return () => {
            if (frameId !== undefined) window.cancelAnimationFrame(frameId);
            if (pollTimer) window.clearTimeout(pollTimer);
            if (modalTimer) window.clearTimeout(modalTimer);
        };
    }, [active_tab, blockly_store.is_loading, BOT_BUILDER]);

    useEffect(() => {
        if (is_open) setTourDialogVisibility(false);

        if (init_render.current) {
            setActiveTab(Number(activeHashTab));
            init_render.current = false;
        } else {
            const search = window.location.search;
            const nextHash = NAV_HASHES[active_tab] || NAV_HASHES[0];
            navigate(`${search}#${nextHash}`, { replace: true });
        }

        if (active_tour) setActiveTour('');
    }, [
        activeHashTab,
        active_tab,
        active_tour,
        is_open,
        navigate,
        setActiveTab,
        setActiveTour,
        setTourDialogVisibility,
    ]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const workspace = (window as any).Blockly?.derivWorkspace;
            if (active_tab !== BOT_BUILDER || !workspace?.trashcan) return;

            const y = window.innerHeight - 250;
            const x = is_drawer_open_position() ? (isDbotRTL() ? 380 : window.innerWidth - 460) : (isDbotRTL() ? 20 : window.innerWidth - 100);
            workspace.trashcan.setTrashcanPosition(x, y);
        }, 100);

        return () => window.clearTimeout(timer);

        function is_drawer_open_position() {
            return Boolean(run_panel.is_drawer_open);
        }
    }, [active_tab, BOT_BUILDER, run_panel.is_drawer_open]);

    useEffect(() => {
        if (!dashboard_strategies.length) return undefined;

        const timer = window.setTimeout(updateWorkspaceName);
        return () => window.clearTimeout(timer);
    }, [dashboard_strategies, active_tab]);

    const handleLoginGeneration = async () => {
        const oauthUrl = await generateOAuthURL();
        if (oauthUrl) window.location.replace(oauthUrl);
        else console.error('Failed to generate OAuth URL');
    };

    const getTradeTypeModalProps = () => {
        const { tradeTypeData } = tradeTypeModalState;

        return {
            is_visible: tradeTypeModalState.isVisible,
            trade_type_display_name: tradeTypeData?.displayName || '',
            current_trade_type: tradeTypeData?.currentTradeType
                ? `${tradeTypeData.currentTradeType.tradeTypeCategory}/${tradeTypeData.currentTradeType.tradeType}`
                : 'N/A',
            current_trade_type_display_name: tradeTypeData?.currentTradeTypeDisplayName || 'N/A',
        };
    };

    const modalProps = getTradeTypeModalProps();

    return (
        <>
            <div className='main'>
                <div
                    className={classNames('main__container', {
                        'main__container--active': active_tour && active_tab === DASHBOARD && !isDesktop,
                    })}
                >
                    <Tabs active_index={active_tab} className='main__tabs' onTabItemClick={handleTabChange} top>
                        <div
                            label={
                                <>
                                    <LabelPairedObjectsColumnCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                                    <Localize i18n_default_text='Dashboard' />
                                </>
                            }
                            id='id-dbot-dashboard'
                        >
                            <Dashboard handleTabChange={handleTabChange} />
                        </div>

                        <div
                            label={
                                <>
                                    <LabelPairedPuzzlePieceTwoCaptionBoldIcon height='24px' width='24px' fill='var(--text-general)' />
                                    <Localize i18n_default_text='Bot Builder' />
                                </>
                            }
                            id='id-bot-builder'
                        />

                        <div
                            label={
                                <>
                                    <LabelPairedChartLineCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                                    <Localize i18n_default_text='Free Bots' />
                                </>
                            }
                            id='id-free-bots'
                        />

                        <div label={<Localize i18n_default_text='Manual Trading' />} id='id-manual-trading' />

                        <div
                            label={
                                <>
                                    <LabelPairedChartLineCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                                    <Localize i18n_default_text='Charts' />
                                </>
                            }
                            id={
                                is_chart_modal_visible || is_trading_view_modal_visible
                                    ? 'id-charts--disabled'
                                    : 'id-charts'
                            }
                        >
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading chart...')} />}>
                                <ChartWrapper show_digits_stats={false} />
                            </Suspense>
                        </div>

                        <div label={<Localize i18n_default_text='Bulk Trade' />} id='id-bulk-trade' />
                        <div label={<Localize i18n_default_text='Copy Trading' />} id='id-copy-trading' />
                    </Tabs>
                </div>
            </div>

            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    <RunPanel />
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>

            <MobileWrapper>{!is_open && <RunPanel />}</MobileWrapper>

            <Dialog
                cancel_button_text={cancel_button_text || localize('Cancel')}
                className='dc-dialog__wrapper--fixed'
                confirm_button_text={ok_button_text || localize('Ok')}
                has_close_icon
                is_mobile_full_width={false}
                is_visible={is_dialog_open}
                onCancel={onCancelButtonClick}
                onClose={onCloseDialog}
                onConfirm={onOkButtonClick || onCloseDialog}
                portal_element_id='modal_root'
                title={title}
                login={handleLoginGeneration}
                dismissable={dismissable}
                is_closed_on_cancel={is_closed_on_cancel}
            >
                {message}
            </Dialog>

            <TradeTypeConfirmationModal
                is_visible={modalProps.is_visible}
                trade_type_display_name={modalProps.trade_type_display_name}
                current_trade_type={modalProps.current_trade_type}
                current_trade_type_display_name={modalProps.current_trade_type_display_name}
                onConfirm={handleTradeTypeConfirm}
                onCancel={handleTradeTypeCancel}
            />
        </>
    );
});

export default AppWrapper;
