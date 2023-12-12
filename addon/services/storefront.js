import Service from '@ember/service';
import Evented from '@ember/object/evented';
import { inject as service } from '@ember/service';
import { get } from '@ember/object';

/**
 * Service to manage storefront operations.
 */
export default class StorefrontService extends Service.extend(Evented) {
    /**
     * Ember service for data store.
     * @type {Service}
     */
    @service store;

    /**
     * Ember service for fetch operations.
     * @type {Service}
     */
    @service fetch;

    /**
     * Ember service for notifications.
     * @type {Service}
     */
    @service notifications;

    /**
     * Ember service for current user information.
     * @type {Service}
     */
    @service currentUser;

    /**
     * Ember service for managing modals.
     * @type {Service}
     */
    @service modalsManager;

    /**
     * Ember service for router operations.
     * @type {Service}
     */
    @service hostRouter;

    /**
     * Gets the active store.
     * @returns {Object} The active store object.
     */
    get activeStore() {
        return this.findActiveStore();
    }

    /**
     * Sets the active storefront.
     * @param {Object} store - The store to set as active.
     */
    setActiveStorefront(store) {
        this.currentUser.setOption('activeStorefront', store.id);
        this.trigger('storefront.changed', store);
    }

    /**
     * Gets the active store or a specific property of it.
     * @param {string|null} property - The property to retrieve from the active store.
     * @returns {Object|null} The active store or its specific property.
     */
    getActiveStore(property = null) {
        if (this.activeStore) {
            if (typeof property === 'string') {
                return get(this.activeStore, property);
            }

            return this.activeStore;
        }

        return null;
    }

    /**
     * Finds the active store based on the current user's settings.
     * @returns {Object|null} The active store object or null if not found.
     */
    findActiveStore() {
        const activeStoreId = this.currentUser.getOption('activeStorefront');

        if (!activeStoreId) {
            const stores = this.store.peekAll('store');

            if (stores.firstObject) {
                this.currentUser.setOption('activeStorefront', stores.firstObject.id);
            }

            return stores.firstObject;
        }

        const activeStore = this.store.peekRecord('store', activeStoreId);

        if (!activeStore) {
            this.currentUser.setOption('activeStorefront', undefined);

            return this.findActiveStore();
        }

        return activeStore;
    }

    /**
     * Alerts about an incoming order.
     * @param {string} orderId - The ID of the incoming order.
     * @param {Object} store - The store associated with the order.
     */
    async alertIncomingOrder(orderId, store) {
        const order = await this.store.queryRecord('order', {
            public_id: orderId,
            single: true,
            with: ['customer', 'payload', 'trackingNumber'],
        });

        this.playAlert();
        this.trigger('order.incoming', order, store);

        this.modalsManager.show('modals/incoming-order', {
            title: 'You have a new incoming order!',
            acceptButtonText: 'Accept Order',
            acceptButtonIcon: 'check',
            acceptButtonIconPrefix: 'fas',
            declineButtonText: 'Decline Order',
            declineButtonScheme: 'danger',
            closeButton: false,
            backdropClose: false,
            order,
            store,
            confirm: (modal) => {
                modal.startLoading();

                return this.fetch
                    .post('orders/accept', { order: order.id }, { namespace: 'storefront/int/v1' })
                    .then(() => {
                        this.trigger('order.accepted', order);
                        modal.stopLoading();
                    })
                    .catch((error) => {
                        this.notifications.serverError(error);
                    });
            },
        });
    }

    /**
     * Listens for incoming orders and handles them.
     */
    async listenForIncomingOrders() {
        const store = this.findActiveStore();

        if (!store) {
            return;
        }

        // create socketcluster client
        const socket = this.socket.instance();

        // listen on company channel
        const channel = socket.subscribe(`storefront.${store.public_id}`);

        // listen to channel for events
        await channel.listener('subscribe').once();

        // get incoming data and console out
        for await (let broadcast of channel) {
            if (broadcast.event === 'order.created') {
                console.log('[new order]', broadcast);
                this.trigger('order.broadcasted', broadcast);
                this.alertIncomingOrder(broadcast.data.id, store);
            }
        }

        // disconnect when transitioning
        this.hostRouter.on('routeWillChange', channel.close);
    }

    /**
     * Creates the first store with given options.
     * @param {Object} [options={}] - Options for creating the first store.
     */
    createFirstStore(options = {}) {
        const store = this.store.createRecord('store');
        const currency = this.currentUser.getWhoisProperty('currency.code');

        if (currency) {
            store.setProperties({ currency });
        }

        this.modalsManager.show('modals/create-first-store', {
            title: 'Create your first Storefront',
            acceptButtonIcon: 'check',
            acceptButtonIconPrefix: 'fas',
            closeButton: false,
            backdropClose: false,
            keyboard: true,
            hideDeclineButton: false,
            declineButtonDisabled: false,
            declineButtonIcon: 'times',
            declineButtonIconPrefix: 'fas',
            store,
            confirm: (modal, done) => {
                modal.startLoading();

                store
                    .save()
                    .then((store) => {
                        this.notifications.success('Your new storefront has been created!');
                        this.setActiveStorefront(store);
                        return done();
                    })
                    .catch((error) => {
                        modal.stopLoading();
                        this.notifications.serverError(error);
                    });
            },
            decline: () => {
                this.hostRouter.transitionTo('console');
            },
            ...options,
        });
    }

    /**
     * Creates a new storefront with given options.
     * @param {Object} [options={}] - Options for creating the new storefront.
     */
    createNewStorefront(options = {}) {
        const store = this.store.createRecord('store');
        const currency = this.currentUser.getWhoisProperty('currency.code');

        if (currency) {
            store.setProperties({ currency });
        }

        this.modalsManager.show('modals/create-store', {
            title: 'Create a new Storefront',
            acceptButtonIcon: 'check',
            acceptButtonIconPrefix: 'fas',
            declineButtonIcon: 'times',
            declineButtonIconPrefix: 'fas',
            store,
            confirm: (modal, done) => {
                modal.startLoading();

                store
                    .save()
                    .then((store) => {
                        this.notifications.success('Your new storefront has been created!');
                        // this.currentUser.setOption('activeStorefront', store.id);
                        this.setActiveStorefront(store);

                        if (typeof options?.onSuccess === 'function') {
                            options.onSuccess(store);
                        }

                        return done();
                    })
                    .catch((error) => {
                        modal.stopLoading();
                        this.notifications.serverError(error);
                    });
            },
            ...options,
        });
    }

    /**
     * Plays an alert sound.
     */
    playAlert() {
        // eslint-disable-next-line no-undef
        const alert = new Audio('/sounds/storefront_order_alert.mp3');

        try {
            alert.play();
        } catch (error) {
            // do nothing with error
        }
    }
}
